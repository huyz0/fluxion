import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { type WriteFluxHtmlInput, writeFluxHtml } from './flux-html.js';
import { type FluxWriteFailure, type WriteFluxInput, writeFlux } from './flux-writer.js';
import { DEFAULT_LIMITS } from './loader-core.js';
import { isShapePackLock, validateShapePackEntries } from './shape-pack-lock.js';
import { type PreparedShapePacks, type PrepareShapePacksOptions, prepareUsedShapePacks, type ShapePackSourceData } from './shape-pack-prepare.js';
import { snapshotWriteInput } from './write-snapshot.js';
import { readZip, type ZipLimits } from './zip.js';

/** Portable save inputs: explicit sources and loaded unresolved-reference provenance. @public */
export type WritePortableFluxInput = WriteFluxInput & {
  /** Limits of the loader that will open the file; a save retaining artwork fonts is checked against them (default: the loader's). */
  readonly destinationLimits?: ZipLimits;
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

/** The extra entries with validated old known shape entries replaced by the prepared ones; collisions with opaque entries fail. */
async function replacedEntries(captured: WriteFluxInput, prepared: PreparedShapePacks): Promise<Result<Map<string, Uint8Array>, FluxWriteFailure>> {
  const extras = new Map(captured.extraEntries);
  const policy = captured.shapePackLicensePolicy;
  // Old entries are only identified for removal here, so their fonts need not be among the assets.
  const old = await validateShapePackEntries(captured.plugins, extras, { policy, hasher: captured.hasher, fonts: false });
  if (!old.ok) return err({ kind: 'invalid', reason: old.error.message });
  for (const lock of old.value.locks) extras.delete(lock.entry);
  for (const [name, bytes] of prepared.extraEntries) {
    if (extras.has(name)) return err({ kind: 'invalid', reason: `prepared shape entry collides with opaque entry ${name}` });
    extras.set(name, bytes);
  }
  return ok(extras);
}

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
    // Partial destination limits fall back to the loader's own defaults, captured before any await.
    const limits: ZipLimits = { ...DEFAULT_LIMITS, ...input.destinationLimits };
    const prepared = await prepareUsedShapePacks(captured.document, input.shapePacks.sources, { ...input.shapePacks, hasher: captured.hasher });
    if (!prepared.ok) return err({ kind: 'invalid', reason: prepared.error.map((d) => `${d.path}: ${d.message}`).join('; ') });
    const extras = await replacedEntries({ ...captured, shapePackLicensePolicy: policy }, prepared.value);
    if (!extras.ok) return extras;
    const plugins = [...(captured.plugins ?? []).filter((lock) => !isShapePackLock(lock)), ...prepared.value.locks];
    // One hash is one binary: a retained font is written once, under the name its 1.1 lock resolves.
    const assets = new Map(captured.assets ?? []);
    for (const [hash, bytes] of prepared.value.fontAssets) assets.set(hash, { bytes, mime: 'font/woff2', ext: 'woff2' });
    const written = await writeFlux({ ...captured, plugins, assets, extraEntries: extras.value, shapePackLicensePolicy: policy });
    if (!written.ok) return written;
    // A save that retains artwork fonts must reopen: check the whole final archive against the destination's limits.
    if (prepared.value.fontAssets.size && !readZip(written.value, limits).ok)
      return err({ kind: 'invalid', reason: 'the archive retaining artwork fonts exceeds the destination loader limits' });
    return ok({ bytes: written.value, diagnostics: prepared.value.diagnostics });
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
