// Exact artwork fonts in the page (ADR-0192, M18.97): verified bytes become a `FontFace` under their private alias, never under
// the source family, so ordinary document text of the same family keeps its own face. One face per byte identity per font set is
// shared by every consumer and leaves the set only when its last owner disposes; a failed or cancelled registration leaves nothing.
import {
  type ArtworkFontRequirement,
  type ArtworkShapeRegistries,
  artworkFontAlias,
  artworkFontRequirements,
  checkVersionedShapePackSubsets,
  type Disposable,
  registerVersionedShapePackSubsets,
  type ShapePackLicensePolicy,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';

/**
 * A required artwork font with the bytes the host holds for it (undefined when it has none).
 *
 * @public
 */
export type ArtworkFontBytes = ArtworkFontRequirement & {
  /** The exact bytes, or undefined when they are missing. */
  readonly bytes: Uint8Array | undefined;
};

/**
 * What registering artwork fonts needs from its host.
 *
 * @public
 */
export type ArtworkFontPorts = {
  /** Lowercase SHA-256 hex of bytes (SubtleCrypto, or format's pure `sha256Hex`). */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  /** The set to register into; default the page's `document.fonts`. */
  readonly fonts?: FontFaceSet;
  /** Cancels the registration; sampled after every await. */
  readonly signal?: AbortSignal;
};

/**
 * Registered artwork fonts: the byte identities now drawable, and their release.
 *
 * @public
 */
export type RegisteredArtworkFonts = {
  /** Byte identities loaded under their aliases, for `registerVersionedShapePackSubsets`. */
  readonly registered: ReadonlySet<string>;
  /** Release this registration's ownership; a face leaves the set with its last owner. Idempotent. */
  readonly dispose: () => void;
};

type Shared = { refs: number; readonly ready: Promise<FontFace | undefined> };
const shared = new WeakMap<FontFaceSet, Map<string, Shared>>();
const problem = (message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: '/shapePacks', message });

function tableOf(fonts: FontFaceSet): Map<string, Shared> {
  let table = shared.get(fonts);
  if (table === undefined) {
    table = new Map();
    shared.set(fonts, table);
  }
  return table;
}

function acquire(fonts: FontFaceSet, font: ArtworkFontRequirement, bytes: Uint8Array): Shared {
  const table = tableOf(fonts);
  const existing = table.get(font.alias);
  if (existing !== undefined) {
    existing.refs++;
    return existing;
  }
  const ready = (async () => {
    const face = new FontFace(font.alias, bytes.slice().buffer, { weight: String(font.weight), style: font.style });
    try {
      await face.load();
    } catch {
      return undefined;
    }
    if (face.status !== 'loaded') return undefined;
    fonts.add(face);
    return face;
  })();
  const entry: Shared = { refs: 1, ready };
  table.set(font.alias, entry);
  return entry;
}

function release(fonts: FontFaceSet, alias: string, entry: Shared): void {
  entry.refs--;
  if (entry.refs > 0) return;
  const table = tableOf(fonts);
  if (table.get(alias) === entry) table.delete(alias);
  void entry.ready.then((face) => {
    if (face !== undefined) fonts.delete(face);
  });
}

/** Why `font` cannot be registered from `bytes`, or undefined. */
async function refusal(font: ArtworkFontBytes, bytes: Uint8Array | undefined, sha256: ArtworkFontPorts['sha256']): Promise<string | undefined> {
  if (bytes === undefined) return `artwork font ${font.sha256} is missing; its text is not drawn in another face`;
  if (font.alias !== artworkFontAlias(font.sha256)) return `artwork font ${font.sha256} has a foreign alias`;
  if (bytes.byteLength !== font.size || (await sha256(bytes)) !== font.sha256) return `artwork font ${font.sha256} does not match its declared bytes`;
  return undefined;
}

/**
 * Verify and register exact artwork fonts under their private aliases. Every font is checked (present, exact size and hash) before
 * any face is created, and every face must load; otherwise, or when `signal` aborts, nothing this call added stays and the result
 * is the diagnostics. Bytes are copied before the first await, so later changes to the inputs have no effect.
 *
 * @public
 */
export async function registerArtworkFonts(
  fonts: readonly ArtworkFontBytes[],
  ports: ArtworkFontPorts,
): Promise<Result<RegisteredArtworkFonts, readonly Diagnostic[]>> {
  const set = ports.fonts ?? document.fonts;
  const inputs = fonts.map((font) => ({ font, bytes: font.bytes?.slice() }));
  const cancelled = () => err([problem('artwork font registration was cancelled')]);
  const refused: string[] = [];
  for (const { font, bytes } of inputs) {
    const reason = await refusal(font, bytes, ports.sha256);
    if (reason !== undefined) refused.push(reason);
    if (ports.signal?.aborted) return cancelled();
  }
  if (refused.length) return err(refused.map(problem));
  const owned = inputs.map(({ font, bytes }) => ({ alias: font.alias, entry: acquire(set, font, bytes as Uint8Array) }));
  let released = false;
  const dispose = () => {
    if (released) return;
    released = true;
    for (const { alias, entry } of owned) release(set, alias, entry);
  };
  const faces = await Promise.all(owned.map(({ entry }) => entry.ready));
  if (ports.signal?.aborted) {
    dispose();
    return cancelled();
  }
  const failed = inputs.filter((_, i) => faces[i] === undefined).map(({ font }) => `artwork font ${font.sha256} could not be loaded`);
  if (failed.length) {
    dispose();
    return err(failed.map(problem));
  }
  return ok({ registered: new Set(inputs.map(({ font }) => font.sha256)), dispose });
}

/**
 * What registering saved shape packs needs from its host.
 *
 * @public
 */
export type SavedShapePackPorts = ArtworkFontPorts & {
  /** The verified bytes of a byte identity (a loader's assets by hash), or undefined. */
  readonly bytesOf: (sha256: string) => Uint8Array | undefined;
  /** The content license policy the subsets are validated under. */
  readonly policy: ShapePackLicensePolicy;
};

/**
 * Register saved 1.0 and 1.1 shape packs for drawing: load the exact artwork fonts they bind from `bytesOf` (a loader's verified
 * assets by hash), then register geometry and bindings. The packs are parsed, their rights checked and their namespaces found free
 * before any font is read. Any refusal or cancellation leaves no face, definition or binding behind, and no text is drawn in a
 * fallback face. The disposer releases all three.
 *
 * @public
 */
export async function registerSavedShapePacks(
  registries: ArtworkShapeRegistries,
  packs: readonly VersionedShapePackSubset[],
  ports: SavedShapePackPorts,
): Promise<Result<Disposable, readonly Diagnostic[]>> {
  const { bytesOf, policy } = ports;
  // parsed, rights checked and namespaces free before any face exists: a refused pack never touches the page
  const checked = checkVersionedShapePackSubsets(registries.shapeDefs, packs, policy);
  if (!checked.ok) return checked;
  const fonts = await registerArtworkFonts(
    artworkFontRequirements(checked.value).map((font) => ({ ...font, bytes: bytesOf(font.sha256) })),
    ports,
  );
  if (!fonts.ok) return fonts;
  if (ports.signal?.aborted) {
    fonts.value.dispose();
    return err([problem('artwork font registration was cancelled')]);
  }
  const shapes = registerVersionedShapePackSubsets(registries, packs, policy, fonts.value.registered);
  if (!shapes.ok) {
    fonts.value.dispose();
    return shapes;
  }
  return ok({
    dispose: () => {
      shapes.value.dispose();
      fonts.value.dispose();
    },
  });
}
