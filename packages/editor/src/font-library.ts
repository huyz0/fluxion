// Adding a font to the open document (FR-THM-008, ADR-0022, M9.16): a file the user uploads, or the slice of a Google font the
// studio fetched, becomes an `asset` record that carries the family, weight, style, licence and the recorded metrics, its bytes go
// to the asset store, and the page loads the face and measures with its metrics from then on. One transaction for the record
// (`asset.create`, one undo step); the bytes, the face and the metrics are the host's and follow it.

import type { FaceMetrics } from '@fluxion/core';
import { loadFontFaces, recordFaceMetrics, registerFontMetrics } from '@fluxion/render';
import { type AssetRecord, err, ok, type RecordId, type Result } from '@fluxion/schema';
import { type FontFileInfo, type FontFormat, readFontFile, type ThemeError } from '@fluxion/theme';
import type { AssetStore } from './asset-store.js';
import type { Execute } from './pointer.js';

/**
 * A font to add: its bytes and where they came from.
 *
 * @public
 */
export type FontInput = {
  /** The file's bytes. */
  readonly bytes: Uint8Array;
  /** The file name, kept on the asset (and the source of the family when the file names none). */
  readonly name: string;
  /** Where the bytes come from. */
  readonly source: 'upload' | 'google';
  /** The licence (SPDX id for a Google font; whatever the user gives for an upload; default `unknown`). */
  readonly license?: string;
  /** The copyright line that travels with the bytes. */
  readonly copyright?: string;
  /** The family the document will name it by (default: the file's, else the file name's). */
  readonly family?: string;
  /** The CSS weight (default: the file's, else 400). */
  readonly weight?: number;
  /** The CSS style (default: the file's, else normal). */
  readonly style?: 'normal' | 'italic';
  /** The unicode-range of a slice of a Google font. */
  readonly unicodeRange?: string;
  /**
   * Whether the page measures with this face's recorded metrics (default true). A slice that is not the family's Latin one is drawn
   * from its range but not registered: the table covers Latin, and a second slice would replace the first.
   */
  readonly measure?: boolean;
};

/**
 * What adding a font needs from the host, with the page's defaults.
 *
 * @public
 */
export type FontLibraryDeps = {
  /** Runs a command. */
  readonly execute: Execute;
  /** Holds the bytes of the document's assets. */
  readonly assets: AssetStore;
  /** A fresh record id. */
  readonly newId: () => RecordId;
};

const MIME: { readonly [format in FontFormat]: string } = { woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };

const fail = (code: ThemeError['code'], message: string): Result<never, ThemeError> => err({ code, message });

/** The lower-case hex SHA-256 of `bytes`. */
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A data URL of `bytes` of the media type `mime`. */
function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/** A family name from a file name: the stem up to a weight or style word (`Fira-Bold.woff2` is `Fira`), dashes and underscores as spaces. */
const familyFromName = (name: string): string =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_ ](regular|bold|italic|light|medium|thin|black|semibold|extrabold|[1-9]00).*$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Uploaded font';

type Face = { readonly family: string; readonly weight: number; readonly style: 'normal' | 'italic' };

/** The face `input` names (what the caller gave, else what the file says, else the file name and the defaults), or FONT_INVALID for a family or weight that cannot be one. */
function faceOf(input: FontInput, info: FontFileInfo): Result<Face, ThemeError> {
  const face: Face = {
    family: (input.family ?? info.family ?? familyFromName(input.name)).trim(),
    weight: input.weight ?? info.weight ?? 400,
    style: input.style ?? info.style ?? 'normal',
  };
  // what the caller named is checked before the bytes are blamed
  if (face.family === '' || /[\p{Cc}<>]/u.test(face.family))
    return fail('FONT_INVALID', `${input.name}: the family is empty or has control characters, "<" or ">"`);
  if (!Number.isInteger(face.weight) || face.weight < 1 || face.weight > 1000)
    return fail('FONT_INVALID', `${input.name}: the weight is not a whole number from 1 to 1000`);
  return ok(face);
}

/** The asset record of the font `input` with the recorded `metrics`. */
async function assetOf(id: RecordId, input: FontInput, parts: { face: Face; metrics: FaceMetrics; mime: string }): Promise<AssetRecord> {
  return {
    id,
    type: 'asset',
    hash: await sha256(input.bytes),
    mime: parts.mime,
    size: input.bytes.byteLength,
    name: input.name,
    font: {
      ...parts.face,
      source: input.source,
      license: input.license ?? 'unknown',
      ...(input.copyright !== undefined && { copyright: input.copyright }),
      ...(input.unicodeRange !== undefined && { unicodeRange: input.unicodeRange }),
      metrics: parts.metrics,
    },
  };
}

/**
 * Add the font in `input` to the document: FONT_FORMAT, FONT_TOO_LARGE or FONT_CORRUPT when the bytes are not a font this editor
 * takes, FONT_INVALID for a family or weight that cannot be one, FONT_CORRUPT when the browser cannot load the bytes or the document
 * refuses the asset (then the page has been told nothing). The asset's id when it worked.
 *
 * @public
 */
export async function addFont(deps: FontLibraryDeps, input: FontInput): Promise<Result<RecordId, ThemeError>> {
  const info = readFontFile(input.bytes);
  if (!info.ok) return info;
  const named = faceOf(input, info.value);
  if (!named.ok) return named;
  const face = named.value;
  const metrics = await recordFaceMetrics(input.bytes, face).catch(() => undefined);
  if (metrics === undefined) return fail('FONT_CORRUPT', `${input.name}: the browser cannot load these bytes as a font`);
  const mime = MIME[info.value.format];
  const url = dataUrl(input.bytes, mime);
  const asset = await assetOf(deps.newId(), input, { face, metrics, mime });
  // the document first: when it refuses, the page has been told nothing
  const created = deps.execute('asset.create', { asset });
  if (!created.ok) return fail('FONT_CORRUPT', `${input.name}: the document refused the asset: ${created.error.message}`);
  deps.assets.set(asset.id, url);
  // the page then draws with the face and measures with its metrics; a face that does not load (the recording just did) is drawn as its fallback
  const loaded = await loadFontFaces([{ ...face, url, ...(input.unicodeRange !== undefined && { unicodeRange: input.unicodeRange }) }]).then(
    () => true,
    () => false,
  );
  if (loaded && input.measure !== false) registerFontMetrics([metrics]);
  return ok(asset.id);
}
