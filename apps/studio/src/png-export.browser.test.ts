import { afterEach, describe, expect, it } from 'vitest';
import { exportScreenPng, screenElementSize, screenSvg } from './png-export.js';

const created: HTMLElement[] = [];
afterEach(() => {
  for (const el of created.splice(0)) el.remove();
});

/** A screen element like `ScreenView`'s: the page size in its styles, scaled by a fit transform, with a red box and an edit overlay. */
function screen(w: number, h: number): HTMLElement {
  const section = document.createElement('section');
  section.className = 'fx-screen';
  section.style.cssText = `position:relative;width:${w}px;height:${h}px;background:#ffffff;transform:translate(10px,10px) scale(0.5);transform-origin:0 0`;
  section.innerHTML =
    '<div class="fx-content" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#ff0000"></div>' +
    '<div class="fx-overlay" style="position:absolute;left:0;top:0;width:400px;height:300px;background:#00ff00"></div>';
  document.body.append(section);
  created.push(section);
  return section;
}

/** The width and height a PNG file declares in its IHDR chunk. */
function pngSize(bytes: Uint8Array): { w: number; h: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

describe('the studio PNG export (FR-AI-006)', () => {
  it("FR-AI-006: the studio exports a screen as a PNG of the screen's size", async () => {
    const el = screen(400, 300);
    const bytes = await exportScreenPng(el);
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 400x300 whatever the fit transform the live element sits under
    expect(pngSize(bytes)).toEqual({ w: 400, h: 300 });
    // the content is drawn (the red box at the corner), the edit overlay is not (the green block would cover it)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(bitmap, 0, 0);
    expect(Array.from(ctx?.getImageData(50, 50, 1, 1).data ?? [])).toEqual([255, 0, 0, 255]);
    expect(Array.from(ctx?.getImageData(350, 250, 1, 1).data ?? [])).toEqual([255, 255, 255, 255]);
  });

  it('FR-AI-006: the element size is read from its styles, and an element without one cannot be exported', async () => {
    expect(screenElementSize(screen(640, 360))).toEqual({ w: 640, h: 360 });
    const bare = document.createElement('div');
    expect(screenElementSize(bare)).toBeUndefined();
    await expect(exportScreenPng(bare)).rejects.toThrow('no size');
  });

  it('FR-AI-006: the serialized SVG is unscaled and holds no overlay', () => {
    const svg = screenSvg(screen(200, 100), { w: 200, h: 100 });
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain('transform: none');
    expect(svg).not.toContain('fx-overlay');
  });
});
