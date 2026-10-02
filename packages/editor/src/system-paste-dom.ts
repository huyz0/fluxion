// Reading what is not Fluxion's off a paste event (FR-EDT-007, NFR-SEC-001, M7.23), in ADR-0020's order after the
// payload: image files, then SVG (an `image/svg+xml` file, or `text/plain` that is an `<svg>` document), then text.
// `pastedKind` decides synchronously (a paste event must be taken before it ends); `readSystemItem` reads the bytes.
// An SVG goes through `sanitizeSvg` before anything of it is kept; an image must decode, and is capped in size.
import { sanitizeSvg } from '@fluxion/format';
import type { SystemItem } from './system-paste.js';

/** The raster image types that are pasted. */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

/** The most bytes of an image that is pasted. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Whether `text` is an SVG document (not any text that mentions one). */
const looksLikeSvg = (text: string): boolean => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s/>]/i.test(text);

/** The first file of `data` that is a pasted raster image or SVG. */
function fileOf(data: DataTransfer, wanted: (type: string) => boolean): File | undefined {
  return [...data.files].find((f) => wanted(f.type));
}

/**
 * What kind of thing the paste carries, decided at once: an image file, an SVG, plain text, or nothing we take.
 *
 * @public
 */
export function pastedKind(data: DataTransfer): 'image' | 'svg' | 'text' | undefined {
  if (fileOf(data, (t) => IMAGE_TYPES.test(t)) !== undefined) return 'image';
  if (fileOf(data, (t) => t === 'image/svg+xml') !== undefined || looksLikeSvg(data.getData('text/plain'))) return 'svg';
  return data.getData('text/plain') === '' ? undefined : 'text';
}

/** SHA-256 of `bytes`, as 64 lower-case hex digits. */
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `bytes` as a base64 `data:` URL of `mime`. */
function dataUrlOf(mime: string, bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/** The pixel size of the image at `dataUrl`; undefined when it does not decode. */
function decode(dataUrl: string): Promise<{ readonly w: number; readonly h: number } | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 ? { w: image.naturalWidth, h: image.naturalHeight } : undefined);
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}

/** An image item from `bytes` of `mime`; undefined when it is too big or does not decode. */
async function imageItem(mime: string, name: string, bytes: Uint8Array): Promise<SystemItem | undefined> {
  if (bytes.length > MAX_IMAGE_BYTES) return undefined;
  const dataUrl = dataUrlOf(mime, bytes);
  const size = await decode(dataUrl);
  if (size === undefined) return undefined;
  return {
    type: 'image',
    mime,
    name,
    dataUrl,
    hash: await sha256(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
    size: bytes.length,
    w: size.w,
    h: size.h,
  };
}

/** An SVG item from untrusted `text`: sanitised, then kept as the bytes of the clean file; undefined when it is no SVG. */
async function svgItem(text: string, name: string): Promise<SystemItem | undefined> {
  const clean = sanitizeSvg(text);
  return clean === undefined ? undefined : imageItem('image/svg+xml', name, new TextEncoder().encode(clean));
}

/**
 * Read what `data` carries of the `kind` {@link pastedKind} gave; undefined when it cannot be used (an image that does not
 * decode or is too big, text that is no SVG).
 *
 * @public
 */
export async function readSystemItem(data: DataTransfer, source: 'image' | 'svg' | 'text'): Promise<SystemItem | undefined> {
  if (source === 'text') return { type: 'text', text: data.getData('text/plain') };
  if (source === 'image') {
    const file = fileOf(data, (t) => IMAGE_TYPES.test(t));
    return file === undefined ? undefined : imageItem(file.type, file.name || 'pasted image', new Uint8Array(await file.arrayBuffer()));
  }
  const file = fileOf(data, (t) => t === 'image/svg+xml');
  return svgItem(file === undefined ? data.getData('text/plain') : await file.text(), file?.name || 'pasted.svg');
}
