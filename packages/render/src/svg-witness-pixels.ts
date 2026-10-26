import type { SvgPaintRequest } from '@fluxion/format';
import { binaryData, type WitnessFrame } from './svg-witness-frame.js';
import type { WitnessScope } from './svg-witness-lifecycle.js';

function differs(data: Uint8ClampedArray, shade: number): boolean {
  for (let i = 0; i < data.length; i += 4) if (data[i] !== shade || data[i + 1] !== shade || data[i + 2] !== shade || data[i + 3] !== 255) return true;
  return false;
}
/** One owned image and raster, sequential backdrops; no screenshot or platform test port. */
export async function observePixels(frame: WitnessFrame, request: SvgPaintRequest, markup: string, scope: WitnessScope): Promise<boolean> {
  if (!scope.alive()) throw Error('closed witness');
  const image = frame.document.createElement('img');
  const canvas = frame.document.createElement('canvas');
  const cleanup = () => {
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    image.remove();
    canvas.width = canvas.height = 0;
    canvas.remove();
  };
  scope.own(cleanup);
  try {
    image.src = `data:image/svg+xml;base64,${binaryData(new TextEncoder().encode(markup), frame)}`;
    await image.decode();
    if (!scope.alive()) throw Error('closed witness');
    canvas.width = request.width;
    canvas.height = request.height;
    const context = canvas.getContext('2d');
    if (!context || image.naturalWidth !== request.width || image.naturalHeight !== request.height) throw Error('raster dimensions');
    let painted = false;
    for (const shade of [0, 255]) {
      context.fillStyle = `rgb(${shade},${shade},${shade})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      painted = differs(context.getImageData(0, 0, canvas.width, canvas.height).data, shade) || painted;
    }
    return painted;
  } finally {
    cleanup();
  }
}
