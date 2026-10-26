// Explicit fault injection: native resources are real; only await completion is controlled.
// These tests do not qualify native rendering or claim that discarded native promises settle.
import type { SvgPaintRequest } from '@fluxion/format';
import { LIGHT_THEME } from '@fluxion/theme';
import { afterEach, expect, it, vi } from 'vitest';
import { createSvgPaintWitness } from './svg-witness.js';

const samples = JSON.parse(
  Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as { request: SvgPaintRequest }[];
function deferred<T>() {
  let resolve: (value: T) => void = () => {},
    reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function restored(object: object, key: string, descriptor: PropertyDescriptor | undefined): () => void {
  return () => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  };
}
function watchFrames(callback: (frame: HTMLIFrameElement) => void): () => void {
  const native = document.createElement,
    restore = restored(document, 'createElement', Object.getOwnPropertyDescriptor(document, 'createElement'));
  document.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    const node = Reflect.apply(native, this, args) as HTMLElement;
    if (node instanceof HTMLIFrameElement) node.addEventListener('load', () => callback(node), { once: true });
    return node;
  } as Document['createElement'];
  return restore;
}
async function fontBytes(): Promise<Uint8Array> {
  const url = Object.values(
    import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  )[0];
  if (!url) throw Error('missing local font');
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}
afterEach(() => vi.useRealTimers());
for (const outcome of ['resolve', 'reject'] as const) {
  it(`NFR-SEC-001: fault injection ${outcome} after lifetime expiry reaches real font continuation without late work`, async () => {
    const request = samples[3]?.request;
    if (!request) throw Error('missing font request');
    const bytes = await fontBytes(),
      entered = deferred<void>(),
      completion = deferred<FontFace>();
    const restore: (() => void)[] = [];
    let face: FontFace | undefined,
      frame: HTMLIFrameElement | undefined,
      checks = 0,
      images = 0;
    restore.push(
      watchFrames((target) => {
        frame = target;
        const doc = target.contentDocument,
          win = target.contentWindow as (Window & typeof globalThis) | null;
        if (!doc || !win) return;
        const nativeCheck = doc.fonts.check;
        restore.push(restored(doc.fonts, 'check', Object.getOwnPropertyDescriptor(doc.fonts, 'check')));
        doc.fonts.check = function (...args) {
          checks++;
          return Reflect.apply(nativeCheck, this, args) as boolean;
        };
        const nativeCreate = doc.createElement;
        restore.push(restored(doc, 'createElement', Object.getOwnPropertyDescriptor(doc, 'createElement')));
        doc.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
          if (args[0] === 'img' || args[0] === 'canvas') images++;
          return Reflect.apply(nativeCreate, this, args) as HTMLElement;
        } as Document['createElement'];
        restore.push(restored(win, 'FontFace', Object.getOwnPropertyDescriptor(win, 'FontFace')));
        win.FontFace = new Proxy(win.FontFace, {
          construct(native, args, newTarget) {
            const value = Reflect.construct(native, args, newTarget) as FontFace;
            face = value;
            const load = value.load;
            restore.push(restored(value, 'load', Object.getOwnPropertyDescriptor(value, 'load')));
            value.load = function () {
              void (Reflect.apply(load, this, []) as Promise<FontFace>).catch(() => undefined);
              entered.resolve();
              return completion.promise;
            };
            return value;
          },
        });
      }),
    );
    vi.useFakeTimers();
    const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: request.fonts.map((f) => ({ ...f, bytes, profile: 'inter-latin-400-ascii' })) });
    if (!made.ok) throw Error('invalid session');
    try {
      await vi.advanceTimersByTimeAsync(119_000);
      const receipt = made.value.witness(request);
      await entered.promise;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await receipt).toEqual({ identity: request.identity, status: 'unsupported', fontHashes: [] });
      expect(frame?.isConnected).toBe(false);
      expect(face).toBeDefined();
      if (outcome === 'resolve') completion.resolve(face as FontFace);
      else completion.reject(Error('controlled late font failure'));
      await vi.advanceTimersByTimeAsync(0);
      expect(checks).toBe(0);
      expect(images).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      made.value.dispose();
      for (const reset of restore.reverse()) reset();
    }
  });
  it(`NFR-SEC-001: fault injection ${outcome} after decode cancellation cannot resize or read a canvas`, async () => {
    const request = samples[0]?.request;
    if (!request) throw Error('missing request');
    const entered = deferred<void>(),
      completion = deferred<void>(),
      controller = new AbortController();
    const restore: (() => void)[] = [];
    const canvases: HTMLCanvasElement[] = [];
    let images = 0,
      reads = 0,
      frame: HTMLIFrameElement | undefined;
    restore.push(
      watchFrames((target) => {
        frame = target;
        const doc = target.contentDocument;
        if (!doc) return;
        const nativeCreate = doc.createElement;
        restore.push(restored(doc, 'createElement', Object.getOwnPropertyDescriptor(doc, 'createElement')));
        doc.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
          const node = Reflect.apply(nativeCreate, this, args) as HTMLElement;
          if (args[0] === 'img') {
            const image = node as HTMLImageElement;
            images++;
            const decode = image.decode;
            restore.push(restored(image, 'decode', Object.getOwnPropertyDescriptor(image, 'decode')));
            image.decode = function () {
              void (Reflect.apply(decode, this, []) as Promise<void>).catch(() => undefined);
              entered.resolve();
              return completion.promise;
            };
          }
          if (args[0] === 'canvas') {
            const canvas = node as HTMLCanvasElement;
            canvases.push(canvas);
            const getContext = canvas.getContext;
            restore.push(restored(canvas, 'getContext', Object.getOwnPropertyDescriptor(canvas, 'getContext')));
            canvas.getContext = function (this: HTMLCanvasElement, ...args: Parameters<HTMLCanvasElement['getContext']>) {
              reads++;
              return Reflect.apply(getContext, this, args);
            } as HTMLCanvasElement['getContext'];
          }
          return node;
        } as Document['createElement'];
      }),
    );
    vi.useFakeTimers();
    const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [], signal: controller.signal });
    if (!made.ok) throw Error('invalid session');
    try {
      const receipt = made.value.witness(request);
      await entered.promise;
      controller.abort();
      expect(await receipt).toEqual({ identity: request.identity, status: 'unsupported', fontHashes: [] });
      expect(frame?.isConnected).toBe(false);
      if (outcome === 'resolve') completion.resolve();
      else completion.reject(Error('controlled late decode failure'));
      await vi.advanceTimersByTimeAsync(0);
      expect(images).toBe(1);
      expect(reads).toBe(0);
      expect(canvases.map((canvas) => [canvas.width, canvas.height, canvas.isConnected])).toEqual([[0, 0, false]]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      made.value.dispose();
      for (const reset of restore.reverse()) reset();
    }
  });
}
