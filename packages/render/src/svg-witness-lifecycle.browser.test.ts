import type { SvgPaintRequest } from '@fluxion/format';
import { LIGHT_THEME } from '@fluxion/theme';
import { expect, it } from 'vitest';
import { createSvgPaintWitness } from './svg-witness.js';

const samples = JSON.parse(
  Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as { request: SvgPaintRequest }[];
function restoreProperty(object: object, key: string, own: PropertyDescriptor | undefined): void {
  if (own) Object.defineProperty(object, key, own);
  else Reflect.deleteProperty(object, key);
}
function observeFrames(callback: (frame: HTMLIFrameElement) => void): () => void {
  const native = document.createElement,
    own = Object.getOwnPropertyDescriptor(document, 'createElement');
  document.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    const node = Reflect.apply(native, this, args) as HTMLElement;
    if (node instanceof HTMLIFrameElement) node.addEventListener('load', () => callback(node), { once: true });
    return node;
  } as Document['createElement'];
  return () => restoreProperty(document, 'createElement', own);
}
async function fontBytes(): Promise<Uint8Array> {
  const url = Object.values(
    import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  )[0];
  if (!url) throw Error('missing local font');
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}
it('NFR-SEC-001: abort at the native font-load await boundary cleans actual resources before continuation', async () => {
  const request = samples[3]?.request;
  if (!request) throw Error('missing text request');
  const controller = new AbortController(),
    bytes = await fontBytes();
  const made = createSvgPaintWitness({
    document,
    theme: LIGHT_THEME,
    fonts: request.fonts.map((f) => ({ ...f, bytes, profile: 'inter-latin-400-ascii' })),
    signal: controller.signal,
  });
  if (!made.ok) throw Error('invalid session');
  const restore: (() => void)[] = [],
    allocated: string[] = [];
  let face: FontFace | undefined, child: Document | undefined, frame: HTMLIFrameElement | undefined;
  let calls = 0,
    registered = false;
  restore.push(
    observeFrames((target) => {
      frame = target;
      child = target.contentDocument ?? undefined;
      const win = target.contentWindow as (Window & typeof globalThis) | null,
        doc = child;
      if (!win || !doc) return;
      const native = doc.createElement,
        previous = Object.getOwnPropertyDescriptor(doc, 'createElement');
      restore.push(() => restoreProperty(doc, 'createElement', previous));
      doc.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
        if (args[0] === 'img' || args[0] === 'canvas') allocated.push(args[0]);
        return Reflect.apply(native, this, args) as HTMLElement;
      } as Document['createElement'];
      const constructorDescriptor = Object.getOwnPropertyDescriptor(win, 'FontFace');
      restore.push(() => restoreProperty(win, 'FontFace', constructorDescriptor));
      win.FontFace = new Proxy(win.FontFace, {
        construct(target, args, newTarget) {
          const value = Reflect.construct(target, args, newTarget) as FontFace;
          face = value;
          const nativeLoad = value.load,
            previousLoad = Object.getOwnPropertyDescriptor(value, 'load');
          restore.push(() => restoreProperty(value, 'load', previousLoad));
          value.load = function () {
            calls++;
            const promise = Reflect.apply(nativeLoad, this, []) as Promise<FontFace>;
            void promise.catch(() => undefined);
            queueMicrotask(() => {
              registered = doc.fonts.has(value);
              controller.abort();
            });
            return promise;
          };
          return value;
        },
      });
    }),
  );
  try {
    expect(await made.value.witness(request)).toEqual({ identity: request.identity, status: 'unsupported', fontHashes: [] });
    expect(calls).toBe(1);
    expect(registered).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(face).toBeDefined();
    expect(child?.fonts.has(face as FontFace)).toBe(false);
    expect(child?.querySelector('.fx-el')).toBeNull();
    expect(frame?.isConnected).toBe(false);
    expect(allocated).toEqual([]);
    expect((await made.value.witness(request)).status).toBe('unsupported');
    made.value.dispose();
    made.value.dispose();
    expect(allocated).toEqual([]);
  } finally {
    made.value.dispose();
    for (const reset of restore.reverse()) reset();
  }
});
it('NFR-SEC-001: abort at native image decode returns bounded refusal and clears actual image and canvas', async () => {
  const request = samples[0]?.request;
  if (!request) throw Error('missing request');
  const controller = new AbortController();
  const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [], signal: controller.signal });
  if (!made.ok) throw Error('invalid session');
  const restore: (() => void)[] = [],
    images: HTMLImageElement[] = [],
    canvases: HTMLCanvasElement[] = [];
  let calls = 0,
    src = '',
    child: Document | undefined,
    frame: HTMLIFrameElement | undefined;
  restore.push(
    observeFrames((target) => {
      frame = target;
      child = target.contentDocument ?? undefined;
      const doc = child;
      if (!doc) return;
      const native = doc.createElement,
        previous = Object.getOwnPropertyDescriptor(doc, 'createElement');
      restore.push(() => restoreProperty(doc, 'createElement', previous));
      doc.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
        const node = Reflect.apply(native, this, args) as HTMLElement;
        if (args[0] === 'canvas') canvases.push(node as HTMLCanvasElement);
        if (args[0] === 'img') {
          const image = node as HTMLImageElement;
          images.push(image);
          const nativeDecode = image.decode,
            previousDecode = Object.getOwnPropertyDescriptor(image, 'decode');
          restore.push(() => restoreProperty(image, 'decode', previousDecode));
          image.decode = function () {
            calls++;
            src = this.getAttribute('src') ?? '';
            const promise = Reflect.apply(nativeDecode, this, []) as Promise<void>;
            void promise.catch(() => undefined);
            queueMicrotask(() => controller.abort());
            return promise;
          };
        }
        return node;
      } as Document['createElement'];
    }),
  );
  try {
    expect(await made.value.witness(request)).toEqual({ identity: request.identity, status: 'unsupported', fontHashes: [] });
    expect(calls).toBe(1);
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(images).toHaveLength(1);
    expect(canvases).toHaveLength(1);
    expect(images[0]?.getAttribute('src')).toBeNull();
    expect(images[0]?.isConnected).toBe(false);
    expect([canvases[0]?.width, canvases[0]?.height, canvases[0]?.isConnected]).toEqual([0, 0, false]);
    expect(child?.querySelector('.fx-el')).toBeNull();
    expect(frame?.isConnected).toBe(false);
    expect((await made.value.witness(request)).status).toBe('unsupported');
    expect(images).toHaveLength(1);
    expect(canvases).toHaveLength(1);
  } finally {
    made.value.dispose();
    for (const reset of restore.reverse()) reset();
  }
});
