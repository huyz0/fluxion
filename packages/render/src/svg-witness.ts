import type { SvgImportFont, SvgPaintReceipt, SvgPaintRequest, SvgPaintWitness } from '@fluxion/format';
import { type Diagnostic, err, isCssColor, ok, type Result } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { createWitnessFrame, loadWitnessFonts, mountWitness } from './svg-witness-frame.js';
import { type PaintContext, snapshotWitnessContext } from './svg-witness-input.js';
import { ownWitness, type WitnessScope } from './svg-witness-lifecycle.js';
import { observePixels } from './svg-witness-pixels.js';
import { admitsPaint, serializeWitness } from './svg-witness-serialize.js';

async function observe(document: Document, context: PaintContext, request: SvgPaintRequest, scope: WitnessScope): Promise<SvgPaintReceipt> {
  if (!admitsPaint(request, context)) throw Error('unsupported context');
  const frame = await createWitnessFrame(document, scope);
  await loadWitnessFonts(frame, request, context, scope);
  const artwork = mountWitness(frame, request, context, scope);
  const disabled = serializeWitness(frame, artwork, { context, request, disabled: true });
  if (await observePixels(frame, request, disabled, scope)) throw Error('invalid disabled control');
  if (!scope.alive()) throw Error('closed witness');
  const markup = serializeWitness(frame, artwork, { context, request });
  const painted = await observePixels(frame, request, markup, scope);
  return { identity: request.identity, status: painted ? 'painted' : 'no-witness', fontHashes: request.fonts.map((f) => f.sha256) };
}
/** Exact pinned font bytes and static face metadata accepted by the witness. @public */
export type SvgWitnessFont = SvgImportFont & {
  /** Exact face bytes, copied and hash-checked before any resource initialization. */
  readonly bytes: Uint8Array;
  /** Initial supported glyph profile: the pinned Inter face, ASCII 32–126. */
  readonly profile: 'inter-latin-400-ascii';
};
/** Explicit host context; construction snapshots data, resources initialize lazily. @public */
export type SvgWitnessOptions = {
  /** Host document capable of same-origin srcdoc frames with the required CSP. */
  readonly document: Document;
  /** Validated bounded active theme, independently snapshotted. */
  readonly theme: Theme;
  /** At most eight faces and 8 MiB total; missing or unsupported faces refuse paint. */
  readonly fonts: readonly SvgWitnessFont[];
  /** Optional owner cancellation; already-aborted construction refuses. */
  readonly signal?: AbortSignal;
};
/** Owned bounded session; disposal cancels outstanding work and releases resources. @public */
export type SvgWitnessSession = {
  /** At most 128 observations, one active call; ten seconds per call inside a 120-second lifetime. */
  readonly witness: SvgPaintWitness;
  /** Idempotent cancellation and resource cleanup. */
  readonly dispose: () => void;
};
/**
 * Observe imported artwork using the shipped renderer in a resource-contained frame.
 * Current color and inherited typography are snapshotted from the document body; exact fonts and
 * theme are owned copies. Unsupported capabilities refuse, never fall back to guessed paint.
 * @public
 */
export function createSvgPaintWitness(options: SvgWitnessOptions): Result<SvgWitnessSession, readonly Diagnostic[]> {
  try {
    const context = snapshotWitnessContext(options.theme, options.fonts);
    const computed = options.document.defaultView?.getComputedStyle(options.document.body);
    if (!context || !computed || !isCssColor(computed.color) || options.signal?.aborted) throw Error('invalid witness context');
    const keys = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-rendering'];
    const styles = Object.fromEntries(keys.map((key) => [key, computed.getPropertyValue(key)]));
    if (Object.values(styles).some((value) => value.length > 4096)) throw Error('context size');
    return ok(ownWitness((request, scope) => observe(options.document, { ...context, styles }, request, scope), options.signal));
  } catch {
    return err([{ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message: 'unsupported SVG paint witness context' }]);
  }
}
