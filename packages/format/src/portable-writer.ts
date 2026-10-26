import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { type WriteFluxHtmlInput, writeFluxHtml } from './flux-html.js';
import { type FluxWriteFailure, type WriteFluxInput, writeFlux } from './flux-writer.js';
import { isShapePackLock, validateShapePackEntries } from './shape-pack-lock.js';
import { type PrepareShapePacksOptions, prepareUsedShapePacks, type ShapePackSourceData } from './shape-pack-prepare.js';
import { snapshotWriteInput } from './write-snapshot.js';

/** Portable save inputs: explicit sources and loaded unresolved-reference provenance. @public */
export type WritePortableFluxInput = WriteFluxInput & {
  /** Source resolution and policy; the archive writer's hash port is used. */
  readonly shapePacks: Omit<PrepareShapePacksOptions, 'hasher'> & {
    /** Explicit distribution or previously embedded geometry sources. */ readonly sources: readonly ShapePackSourceData[];
  };
};
/** Successful portable archive plus warnings the host must display. @public */
export type PortableFluxOutput = {
  /** Complete portable archive bytes. */ readonly bytes: Uint8Array;
  /** Warnings the host must display. */
  readonly diagnostics: readonly Diagnostic[];
};
/** HTML options plus an explicit portable archive save. @public */
export type WritePortableFluxHtmlInput = Omit<WriteFluxHtmlInput, 'flux'> & {
  /** Archive contents and explicit shape resolution policy. */ readonly archive: WritePortableFluxInput;
};
/** Successful portable HTML plus the archive save's unchanged warnings. @public */
export type PortableFluxHtmlOutput = {
  /** Complete self-contained HTML. */ readonly html: string;
  /** Unchanged archive save warnings the host must display. */
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * Save used shape geometry and credits, replacing only validated known entries and retaining
 * opaque locks and bytes. Explicitly preserved unresolved IDs return warnings, never invented
 * geometry. Hosts must display these diagnostics before reporting successful portability.
 * @public
 */
export async function writePortableFlux(input: WritePortableFluxInput): Promise<Result<PortableFluxOutput, FluxWriteFailure>> {
  try {
    const captured = snapshotWriteInput(input);
    const policy = input.shapePacks.licensePolicy;
    const prepared = await prepareUsedShapePacks(captured.document, input.shapePacks.sources, { ...input.shapePacks, hasher: captured.hasher });
    if (!prepared.ok) return err({ kind: 'invalid', reason: prepared.error.map((d) => `${d.path}: ${d.message}`).join('; ') });
    const extras = new Map(captured.extraEntries);
    const old = await validateShapePackEntries(captured.plugins, extras, { policy, hasher: captured.hasher });
    if (!old.ok) return err({ kind: 'invalid', reason: old.error.message });
    for (const lock of old.value.locks) extras.delete(lock.entry);
    for (const [name, bytes] of prepared.value.extraEntries) {
      if (extras.has(name)) return err({ kind: 'invalid', reason: `prepared shape entry collides with opaque entry ${name}` });
      extras.set(name, bytes);
    }
    const plugins = [...(captured.plugins ?? []).filter((lock) => !isShapePackLock(lock)), ...prepared.value.locks];
    const written = await writeFlux({ ...captured, plugins, extraEntries: extras, shapePackLicensePolicy: policy });
    return written.ok ? ok({ bytes: written.value, diagnostics: prepared.value.diagnostics }) : written;
  } catch {
    return err({ kind: 'invalid', reason: 'portable save could not capture or validate its inputs' });
  }
}

/** Compose portable archive and HTML output without discarding archive warnings. @public */
export async function writePortableFluxHtml(input: WritePortableFluxHtmlInput): Promise<Result<PortableFluxHtmlOutput, FluxWriteFailure>> {
  try {
    const { archive, ...html } = input;
    const options = { ...html, hasher: { sha256: html.hasher.sha256.bind(html.hasher) } };
    const written = await writePortableFlux(archive);
    if (!written.ok) return written;
    const wrapped = await writeFluxHtml({ ...options, flux: written.value.bytes });
    return wrapped.ok ? ok({ html: wrapped.value, diagnostics: written.value.diagnostics }) : wrapped;
  } catch {
    return err({ kind: 'invalid', reason: 'portable HTML could not validate or hash its inputs' });
  }
}
