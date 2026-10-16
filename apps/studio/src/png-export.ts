// Export a screen as a PNG (FR-AI-006, the in-browser half of `fluxion render --format png`): the screen's element is cloned with every computed style
// written inline, laid in an SVG `<foreignObject>` of the screen's size, and that SVG is drawn on a canvas and encoded. The clone is unscaled
// (the live element sits under the editor's fit or camera transform) and carries no edit overlay.

/** The size of a screen in CSS pixels. */
export type PngSize = { readonly w: number; readonly h: number };

/** The size the screen's element is laid out at: its own `width` and `height` styles (the page size, before any fit transform). */
export function screenElementSize(el: HTMLElement): PngSize | undefined {
  const [w, h] = [Number.parseFloat(el.style.width), Number.parseFloat(el.style.height)];
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : undefined;
}

/** Copy the computed style of every element of `from` onto the matching element of `to`, so the clone looks the same outside the page's stylesheets. */
function inlineStyles(from: Element, to: Element): void {
  const computed = getComputedStyle(from);
  const target = (to as HTMLElement).style;
  for (const name of Array.from(computed)) target.setProperty(name, computed.getPropertyValue(name));
  const [a, b] = [Array.from(from.children), Array.from(to.children)];
  for (const [i, child] of a.entries()) {
    const twin = b[i];
    if (twin) inlineStyles(child, twin);
  }
}

/** The SVG text that draws `el` at `size`: an unscaled, overlay-free, fully styled clone inside a foreignObject. */
export function screenSvg(el: HTMLElement, size: PngSize): string {
  const clone = el.cloneNode(true) as HTMLElement;
  inlineStyles(el, clone);
  clone.style.transform = 'none';
  clone.style.width = `${size.w}px`;
  clone.style.height = `${size.h}px`;
  for (const overlay of Array.from(clone.querySelectorAll('.fx-overlay'))) overlay.remove();
  const html = new XMLSerializer().serializeToString(clone);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}">` +
    `<foreignObject x="0" y="0" width="${size.w}" height="${size.h}">${html}</foreignObject></svg>`
  );
}

/** Decode an SVG document into an image the canvas can draw. */
function load(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('the screen could not be drawn as an image'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * The PNG bytes of the screen shown by `el` (a `.fx-screen` section), `size` pixels wide and high (its own size when omitted).
 *
 * @public
 */
export async function exportScreenPng(el: HTMLElement, size: PngSize | undefined = screenElementSize(el)): Promise<Uint8Array> {
  if (size === undefined) throw new Error('the screen has no size to export');
  const image = await load(screenSvg(el, size));
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no canvas to draw the screen on');
  ctx.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('the browser could not encode a PNG');
  return new Uint8Array(await blob.arrayBuffer());
}
