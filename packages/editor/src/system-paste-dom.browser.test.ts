import { describe, expect, it } from 'vitest';
import { pastedKind, readSystemItem } from './system-paste-dom.js';

/** A real PNG of `w` x `h`, from a canvas. */
async function png(w: number, h: number): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#336699';
    g.fillRect(0, 0, w, h);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob as Blob], 'shot.png', { type: 'image/png' });
}

const data = (init: { files?: File[]; text?: string }): DataTransfer => {
  const dt = new DataTransfer();
  for (const f of init.files ?? []) dt.items.add(f);
  if (init.text !== undefined) dt.setData('text/plain', init.text);
  return dt;
};
const decoded = (dataUrl: string): string => atob(dataUrl.slice(dataUrl.indexOf(',') + 1));

describe('reading a paste that is not Fluxion`s (FR-EDT-007, NFR-SEC-001)', () => {
  it('FR-EDT-007: the kind is decided at once: an image file, then an SVG (file or text), then text, else nothing', async () => {
    const file = await png(4, 3);
    expect(pastedKind(data({ files: [file], text: '<svg></svg>' }))).toBe('image');
    expect(pastedKind(data({ files: [new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })] }))).toBe('svg');
    for (const svg of [
      '<svg width="1"></svg>',
      '  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<!-- c --><svg/>',
      '<!DOCTYPE svg><svg/>',
    ])
      expect(pastedKind(data({ text: svg }))).toBe('svg');
    // text that only mentions an SVG, or other files, are what they are
    expect(pastedKind(data({ text: 'an <svg> is markup' }))).toBe('text');
    expect(pastedKind(data({ text: 'hello' }))).toBe('text');
    expect(pastedKind(data({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] }))).toBeUndefined();
    expect(pastedKind(data({}))).toBeUndefined();
  });

  it('FR-EDT-007: an image file is read as a data URL with its hash, size and pixel size', async () => {
    const file = await png(30, 20);
    const item = await readSystemItem(data({ files: [file] }), 'image');
    expect(item).toMatchObject({ type: 'image', mime: 'image/png', name: 'shot.png', w: 30, h: 20, size: file.size });
    if (item?.type !== 'image') throw new Error('not an image');
    expect(item.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
    // the hash is of the bytes: the same file again, the same hash; another image, another
    expect(((await readSystemItem(data({ files: [await png(30, 20)] }), 'image')) as { hash: string }).hash).toBe(item.hash);
    expect(((await readSystemItem(data({ files: [await png(31, 20)] }), 'image')) as { hash: string }).hash).not.toBe(item.hash);
    // a file that is no image, though it says so, does not decode and is not pasted
    const broken = new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' });
    expect(await readSystemItem(data({ files: [broken] }), 'image')).toBeUndefined();
    expect(await readSystemItem(data({}), 'image')).toBeUndefined();
  });

  it('NFR-SEC-001: an SVG is sanitised before anything of it is kept, from a file or from text', async () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="alert(1)"><script>alert(2)</script><rect width="40" height="20" fill="#336699"/></svg>';
    for (const source of [data({ text: hostile }), data({ files: [new File([hostile], 'evil.svg', { type: 'image/svg+xml' })] })]) {
      const item = await readSystemItem(source, 'svg');
      if (item?.type !== 'image') throw new Error('not an image');
      expect(item.mime).toBe('image/svg+xml');
      expect(decoded(item.dataUrl)).toBe(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#336699"></rect></svg>',
      );
      expect([item.w, item.h]).toEqual([40, 20]);
    }
    expect((await readSystemItem(data({ files: [new File([hostile], 'evil.svg', { type: 'image/svg+xml' })] }), 'svg'))?.type === 'image' && 'evil.svg').toBe(
      'evil.svg',
    );
    // a file that is no SVG at all is not pasted
    expect(await readSystemItem(data({ files: [new File(['not svg'], 'x.svg', { type: 'image/svg+xml' })] }), 'svg')).toBeUndefined();
  });

  it('FR-EDT-007: text is read as it is', async () => {
    expect(await readSystemItem(data({ text: 'a\nb' }), 'text')).toEqual({ type: 'text', text: 'a\nb' });
  });
});
