// Seed colours from an image the person picks (FR-THM-005, ADR-0055 §Image → palette): the browser decodes it, scaled to at most
// 256 px on its longest side (createImageBitmap), its pixels read from a canvas, and packages/theme's paletteFromPixels draws one to
// three seeds. Decoding stays here: packages/theme only reads RGBA bytes.
import { paletteFromPixels } from '@fluxion/theme';
import { t } from '@lingui/core/macro';
import '../i18n.js';

/** The longest side the picked image is decoded at, in pixels. */
export const IMAGE_SIDE = 256;

/** One to three `#rrggbb` seeds from the image `blob`; an error message when it cannot be decoded or read. */
export async function imageSeeds(blob: Blob): Promise<{ readonly seeds: readonly string[] } | { readonly error: string }> {
  let bitmap: ImageBitmap;
  try {
    const probe = await createImageBitmap(blob);
    const scale = Math.min(1, IMAGE_SIDE / Math.max(probe.width, probe.height));
    const resizeWidth = Math.max(1, Math.round(probe.width * scale));
    const resizeHeight = Math.max(1, Math.round(probe.height * scale));
    probe.close();
    bitmap = await createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'medium' });
  } catch {
    return { error: t`the image could not be read` };
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return { error: t`the image could not be read` };
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { width, height, data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const seeds = paletteFromPixels({ width, height, data });
  return seeds.ok ? { seeds: seeds.value } : { error: seeds.error.message };
}
