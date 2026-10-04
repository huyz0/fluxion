import { describe, expect, it } from 'vitest';
import { readImageFile } from './image-file.js';

/** A JPEG of `w` x `h` drawn in the page. */
async function jpeg(w: number, h: number, name = 'big.jpg'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#336699';
  g.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return new File([blob as Blob], name, { type: 'image/jpeg' });
}

describe('an image file as the document holds it (FR-AST-001, FR-AST-002)', () => {
  it('FR-AST-002: a 4000 px JPEG is scaled to at most 2560 px on its long side, keeping its proportions, with its hash and data URL', async () => {
    const read = await readImageFile(await jpeg(4000, 3000));
    if (!read.ok) throw new Error(read.message);
    const { item } = read;
    expect([item.w, item.h]).toEqual([2560, 1920]);
    expect(item.name).toBe('big.jpg');
    expect(item.dataUrl.startsWith(`data:${item.mime};base64,`)).toBe(true);
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
    // the data URL holds exactly the bytes the hash and size name
    const bytes = new Uint8Array(await (await fetch(item.dataUrl)).arrayBuffer());
    expect(bytes.length).toBe(item.size);
  });

  it('FR-AST-001: a picture within the limit keeps its pixel size', async () => {
    const read = await readImageFile(await jpeg(640, 480));
    expect(read.ok && [read.item.w, read.item.h]).toEqual([640, 480]);
  });

  it('FR-AST-001: a file that is not an image is refused with a message that names it', async () => {
    const read = await readImageFile(new File(['this is text, not a picture'], 'fake.png', { type: 'image/png' }));
    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toMatch(/^fake\.png: /);
  });

  it('NFR-SEC-001: an SVG is rebuilt from its allowlist: a script in it does not reach the document', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>';
    const read = await readImageFile(new File([svg], 'logo.svg', { type: 'image/svg+xml' }));
    if (!read.ok) throw new Error(read.message);
    expect(read.item.mime).toBe('image/svg+xml');
    const text = await (await fetch(read.item.dataUrl)).text();
    expect(text).not.toContain('script');
    expect(text).toContain('rect');
  });

  it('FR-AST-001: a file past the import limit is refused without being read into memory', async () => {
    const file = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 65 * 1024 * 1024 });
    let read = false;
    file.arrayBuffer = () => {
      read = true;
      return Promise.resolve(new ArrayBuffer(0));
    };
    const result = await readImageFile(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/^huge\.jpg: the file is larger than 64 MB$/);
    expect(read).toBe(false);
  });
});
