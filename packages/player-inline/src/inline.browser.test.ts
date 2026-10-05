import { type ContentHasher, writeFlux } from '@fluxion/format';
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw' | '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
  interface Window {
    /** The global the built script defines. */
    Fluxion?: { start(bytes: Uint8Array, root: HTMLElement): Promise<{ ok: boolean; message?: string; unmount?: () => void }> };
  }
}

// the built one-file player (`pnpm build` writes it): a classic script, run here exactly as a `.flux.html` runs it
const BUNDLE = Object.values(import.meta.glob('../dist/player.inline.js', { query: '?raw', import: 'default', eager: true }))[0];

const hasher: ContentHasher = {
  async sha256(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  },
};
const ROBOTO = Object.values(import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true }))[0];
const ROBOTO_METRICS = Object.values(import.meta.glob('../../../fixtures/fonts/roboto.metrics.json', { query: '?raw', import: 'default', eager: true }))[0];
// the security corpus (docs/standards/security.md §7): hostile SVG files and link targets
const SVGS = Object.entries(import.meta.glob('../../../specs/security/corpus/svg-*.svg', { query: '?raw', import: 'default', eager: true })).map(
  ([path, text]) => ({ name: path.split('/').at(-1) ?? path, text }),
);
const LINKS = JSON.parse(
  Object.values(import.meta.glob('../../../specs/security/corpus/links.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as {
  name: string;
  url: string;
  allow: boolean;
}[];
// a 1 x 1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** Two screens with a rectangle each; a picture on the second, from a PNG asset. */
async function deckFile(): Promise<{ bytes: Uint8Array; ids: RecordId[] }> {
  const b = documentBuilder({ seed: 66, title: 'Inline' });
  const first = b.screen({ name: 'one', size: { w: 1600, h: 900 } });
  const second = b.screen({ name: 'two', size: { w: 1600, h: 900 } });
  b.rect(first, { x: 20, y: 20, w: 200, h: 100, label: 'First' });
  b.rect(second, { x: 20, y: 20, w: 200, h: 100, label: 'Second' });
  const doc = b.build();
  const hash = await hasher.sha256(PNG);
  const records: { [id: string]: AnyRecord } = {
    ...doc.records,
    pic: { id: 'pic' as RecordId, type: 'asset', hash, mime: 'image/png', size: PNG.length, name: 'p.png', w: 1, h: 1 } as AnyRecord,
    img: {
      id: 'img' as RecordId,
      type: 'element',
      kind: 'image',
      screenId: second,
      index: 'z0',
      assetId: 'pic' as RecordId,
      transform: { x: 400, y: 20, w: 100, h: 100 },
    } as AnyRecord,
  };
  const document = { ...doc, records } as DocumentFile;
  const zip = await writeFlux({ document, appVersion: '0', hasher, assets: new Map([[hash, { bytes: PNG, mime: 'image/png' }]]) });
  if (!zip.ok) throw new Error(zip.error.reason);
  return { bytes: zip.value, ids: [first, second] };
}

/**
 * A one-screen file holding the hostile corpus as the player will meet it, written without any validation: a text element per link target (a link mark with the
 * target as the corpus gives it), a text element whose words are markup, and an image element per hostile SVG asset.
 */
async function hostileFile(): Promise<Uint8Array> {
  const b = documentBuilder({ seed: 67, title: 'Hostile' });
  const screen = b.screen({ name: 'hostile', size: { w: 1600, h: 900 } });
  const doc = b.build();
  const records: { [id: string]: AnyRecord } = { ...doc.records };
  const assets = new Map<string, { bytes: Uint8Array; mime: string }>();
  const text = (id: string, nodes: unknown[]): AnyRecord =>
    ({
      id: id as RecordId,
      type: 'element',
      kind: 'text',
      screenId: screen,
      index: `t${id}`,
      transform: { x: 10, y: 10, w: 300, h: 40 },
      text: { type: 'doc', content: [{ type: 'paragraph', content: nodes }] },
    }) as AnyRecord;
  LINKS.forEach((link, i) => {
    records[`link${i}`] = text(`link${i}`, [{ type: 'text', text: link.name, marks: [{ type: 'link', attrs: { href: link.url } }] }]);
  });
  records['markup'] = text('markup', [{ type: 'text', text: '<img src=x onerror=alert(1)><script>alert(2)</script>' }]);
  for (const [i, svg] of SVGS.entries()) {
    const bytes = new TextEncoder().encode(svg.text);
    const hash = await hasher.sha256(bytes);
    assets.set(hash, { bytes, mime: 'image/svg+xml' });
    records[`svg${i}`] = { id: `svg${i}`, type: 'asset', hash, mime: 'image/svg+xml', size: bytes.length, name: svg.name, w: 100, h: 100 } as AnyRecord;
    records[`pic${i}`] = {
      id: `pic${i}`,
      type: 'element',
      kind: 'image',
      screenId: screen,
      index: `i${i}`,
      assetId: `svg${i}`,
      transform: { x: 10 + i * 10, y: 100, w: 100, h: 100 },
    } as AnyRecord;
  }
  const zip = await writeFlux({ document: { ...doc, records } as DocumentFile, appVersion: '0', hasher, assets });
  if (!zip.ok) throw new Error(zip.error.reason);
  return zip.value;
}

let root: HTMLElement;
beforeAll(() => {
  if (BUNDLE === undefined) throw new Error('packages/player-inline/dist/player.inline.js is missing: run `pnpm build` first');
  const script = document.createElement('script');
  script.textContent = BUNDLE;
  document.head.append(script);
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => root.remove());

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const shown = () => root.querySelector('.fx-screen')?.getAttribute('data-screen-id');
const press = async (key: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await frame();
};

describe('the one-file player script (FR-FIL-002, FR-EXP-001)', () => {
  it('FR-FIL-002: the script defines Fluxion.start, which opens a .flux, draws its first screen with the bundled shapes, and the arrow keys move through the screens', async () => {
    const { bytes, ids } = await deckFile();
    expect(typeof window.Fluxion?.start).toBe('function');
    const result = await window.Fluxion?.start(bytes, root);
    expect(result?.ok).toBe(true);
    // a slow runner draws later than two frames: wait for the screen rather than for a count of frames
    await vi.waitFor(() => expect(shown()).toBe(ids[0]));
    // the rectangle is the basic pack's shape: drawn by the bundled registries
    expect(root.querySelector('.fx-screen svg, .fx-screen [data-element-id]')).not.toBeNull();
    await press('ArrowRight');
    await vi.waitFor(() => expect(shown()).toBe(ids[1]));
    await press('ArrowLeft');
    await vi.waitFor(() => expect(shown()).toBe(ids[0]));
    result?.unmount?.();
    expect(root.querySelector('.fx-screen')).toBeNull();
  });

  it('FR-FIL-002: an image of the file is drawn from a blob URL made from its own verified bytes, and is released on unmount', async () => {
    const { bytes } = await deckFile();
    const result = await window.Fluxion?.start(bytes, root);
    await vi.waitFor(() => expect(shown()).not.toBeUndefined());
    await press('ArrowRight');
    await vi.waitFor(() => expect(root.querySelector('image, img')).not.toBeNull());
    const image = root.querySelector('image, img');
    const href = image?.getAttribute('href') ?? image?.getAttribute('src') ?? '';
    expect(href.startsWith('blob:')).toBe(true);
    // the URL works while the player is up, and is revoked on unmount
    expect((await fetch(href)).ok).toBe(true);
    result?.unmount?.();
    await expect(fetch(href)).rejects.toThrow();
  });

  it('NFR-SEC-001: the security corpus through the one-file player leaves no script, handler or unsafe URL in the DOM', async () => {
    const result = await window.Fluxion?.start(await hostileFile(), root);
    expect(result?.ok, result?.message).toBe(true);
    await vi.waitFor(() => expect(shown()).not.toBeUndefined());
    await vi.waitFor(() => expect(root.querySelectorAll('img, image').length).toBe(SVGS.length));
    expect(root.querySelector('script, iframe, object, embed, foreignObject, style')).toBeNull();
    const attributes = [...root.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => ({ tag: el.tagName, name: a.name, value: a.value })));
    // no event handler, no script URL anywhere
    expect(attributes.filter((a) => /^on/i.test(a.name))).toEqual([]);
    const compact = (value: string): string => [...value].filter((c) => c.charCodeAt(0) > 32).join('');
    expect(attributes.filter((a) => /^(javascript|vbscript|data):/i.test(compact(a.value)))).toEqual([]);
    // the links: a link is drawn only to http(s), mailto or a screen (the schema's rule, kept by the views); a target of another scheme, a relative or a
    // protocol-relative one is text. (The stricter `safeLinkUrl` of paste and import, which also refuses user information and markup characters, is not the views'.)
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    const SAFE_LINK = /^(?:https?:\/\/|mailto:|#screen:[A-Za-z0-9_-]{1,64}$)/i;
    for (const href of hrefs) expect(href, href).toMatch(SAFE_LINK);
    for (const link of LINKS.filter((l) => !SAFE_LINK.test(l.url))) expect(hrefs, link.name).not.toContain(link.url);
    expect(hrefs.length).toBeGreaterThan(0);
    // words that are markup are words
    expect(root.textContent).toContain('<script>alert(2)</script>');
    expect(root.querySelector('img[onerror]')).toBeNull();
    // every picture is drawn from the sanitised bytes of its own asset: a blob that holds no script, handler or outside reference
    for (const image of root.querySelectorAll('img, image')) {
      const href = image.getAttribute('href') ?? image.getAttribute('src') ?? '';
      expect(href.startsWith('blob:'), href).toBe(true);
      // the namespace declaration is the one URL an SVG may keep
      // what is in a tag runs or loads; escaped text between tags is only text
      const body = ((await (await fetch(href)).text()).match(/<[^>]*>/g) ?? []).join('').replace('xmlns="http://www.w3.org/2000/svg"', '');
      expect(body).not.toMatch(/<script|\son[a-z]+\s*=|javascript:|foreignobject|<style|<a[\s>]|<image|https?:|data:/i);
    }
    result?.unmount?.();
  });

  it('FR-FIL-002: a page that refuses the mount is a message, not an exception, and leaves no image URL behind', async () => {
    const { bytes } = await deckFile();
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      revoke(url);
    };
    try {
      // a root that is not an element: React refuses it after the images were made
      const result = await window.Fluxion?.start(bytes, {} as unknown as HTMLElement);
      expect(result?.ok).toBe(false);
      expect(result?.message).toContain('cannot be shown');
      expect(revoked.length).toBeGreaterThan(0);
    } finally {
      URL.revokeObjectURL = revoke;
    }
  });

  it('FR-FIL-002: a file that cannot be opened is a message in the page, not an exception', async () => {
    const result = await window.Fluxion?.start(new TextEncoder().encode('not a flux file'), root);
    expect(result?.ok).toBe(false);
    expect(root.textContent).toContain('cannot be opened');
    expect(root.querySelector('.fx-screen')).toBeNull();
  });

  it('FR-EXP-001: the script holds nothing that evaluates text, loads code or reaches the network', () => {
    const text = BUNDLE as string;
    for (const pattern of [/\beval\s*\(/, /new Function\s*\(/, /\bimport\s*\(/, /\bfetch\s*\(/, /XMLHttpRequest/, /importScripts/, /WebSocket/, /sendBeacon/]) {
      expect(text, String(pattern)).not.toMatch(pattern);
    }
    // a classic script: no module syntax at the top level
    expect(text.startsWith('var Fluxion=')).toBe(true);
    expect(text).not.toMatch(/^\s*(import|export)\s/m);
  });

  /** A one-screen deck with a font asset named `family`: `bytes` as the file's font, Roboto's recorded metrics under that name. */
  async function fontDeck(family: string, bytes: Uint8Array): Promise<Uint8Array> {
    const b = documentBuilder({ seed: 67, title: 'Font' });
    const screen = b.screen({ name: 'one', size: { w: 1600, h: 900 } });
    b.rect(screen, { x: 20, y: 20, w: 400, h: 100, label: 'Embedded' });
    const doc = b.build();
    const hash = await hasher.sha256(bytes);
    const face = (JSON.parse(ROBOTO_METRICS ?? '{}') as { faces: { weight: number; style: string }[] }).faces.find(
      (f) => f.weight === 400 && f.style === 'normal',
    );
    const font = { family, weight: 400, style: 'normal', source: 'upload', license: 'OFL-1.1', metrics: { ...face, family } };
    const asset = { id: 'font1' as RecordId, type: 'asset', hash, mime: 'font/woff2', size: bytes.length, name: 'probe.woff2', font } as unknown as AnyRecord;
    const document = { ...doc, records: { ...doc.records, font1: asset } } as DocumentFile;
    const zip = await writeFlux({ document, appVersion: '0', hasher, assets: new Map([[hash, { bytes, mime: 'font/woff2' }]]) });
    if (!zip.ok) throw new Error(zip.error.reason);
    return zip.value;
  }
  const loadedFamilies = () => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));

  it('FR-THM-008: a font asset of the file is loaded from its own bytes before the deck is drawn, and is taken out again on unmount', async () => {
    const roboto = new Uint8Array(await (await fetch(ROBOTO ?? '')).arrayBuffer());
    const result = await window.Fluxion?.start(await fontDeck('EmbeddedProbe', roboto), root);
    expect(result?.ok).toBe(true);
    expect(loadedFamilies()).toContain('EmbeddedProbe');
    expect(document.fonts.check('16px EmbeddedProbe')).toBe(true);
    result?.unmount?.();
    expect([...document.fonts].map((f) => f.family.replace(/"/g, ''))).not.toContain('EmbeddedProbe');
  });

  it('FR-THM-008: a font asset whose bytes are not a font is skipped: the deck still opens', async () => {
    const result = await window.Fluxion?.start(await fontDeck('BrokenProbe', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), root);
    expect(result?.ok).toBe(true);
    await frame();
    expect(shown()).not.toBeNull();
    expect(loadedFamilies()).not.toContain('BrokenProbe');
    result?.unmount?.();
  });
});
