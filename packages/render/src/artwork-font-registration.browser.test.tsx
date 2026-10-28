// FR-LIB-004 FR-AST-003: saved artwork text draws only in its exact retained bytes, under a private alias (ADR-0192, M18.97).
import {
  type ArtworkFontBinding,
  allowsShapePackContentLicense,
  artworkFontAlias,
  artworkFontRequirements,
  createCore,
  createRegistry,
  parseVersionedShapePackSubset,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerArtworkFonts, registerSavedShapePacks } from './artwork-font-registration.js';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

const json = import.meta.glob('../../../fixtures/shape-pack/v1.1/subset.json', { query: '?raw', import: 'default', eager: true });
const fonts = {
  ...import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true }),
} as Record<string, string>;
const bytesAt = async (suffix: string) => {
  const url = Object.entries(fonts).find(([path]) => path.endsWith(suffix))?.[1];
  if (url === undefined) throw new Error(`missing ${suffix}`);
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
};
const hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), (b) => b.toString(16).padStart(2, '0')).join('');
const ports = { sha256: hex };
const SHA = '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc';
const ALIAS = artworkFontAlias(SHA);
function subset(): VersionedShapePackSubset {
  const parsed = parseVersionedShapePackSubset(JSON.parse(Object.values(json)[0] ?? 'null'), allowsShapePackContentLicense);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}
/** A signal that reads as aborted from its `after`-th sample on: cancellation at an exact await without timing races. */
const abortedFrom = (after: number) => {
  let reads = 0;
  return {
    get aborted() {
      return ++reads > after;
    },
  } as AbortSignal;
};
const inSet = (family: string) => [...document.fonts].filter((face) => face.family.replace(/"/g, '') === family);

let inter: Uint8Array;
let roboto: Uint8Array;
let host: HTMLElement;
let root: Root;
const extra: FontFace[] = [];
beforeEach(async () => {
  inter ??= await bytesAt('inter-latin-400-normal.woff2');
  roboto ??= await bytesAt('roboto-400.woff2');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const face of extra.splice(0)) document.fonts.delete(face);
  expect(inSet(ALIAS)).toEqual([]);
});
const required = () => artworkFontRequirements([subset()]).map((font) => ({ ...font, bytes: inter }));

describe('registerArtworkFonts', () => {
  it('loads exact bytes under the private alias only, shared until the last owner disposes', async () => {
    const first = await registerArtworkFonts(required(), ports);
    const second = await registerArtworkFonts(required(), ports);
    if (!first.ok || !second.ok) throw new Error('registration failed');
    expect([...first.value.registered]).toEqual([SHA]);
    expect(inSet(ALIAS).map((face) => face.status)).toEqual(['loaded']);
    expect(inSet('Inter')).toEqual([]);
    first.value.dispose();
    first.value.dispose();
    expect(inSet(ALIAS)).toHaveLength(1);
    second.value.dispose();
    await Promise.resolve();
    expect(inSet(ALIAS)).toEqual([]);
  });

  it('refuses missing, resized, changed and undecodable bytes, and cancellation, leaving no face', async () => {
    const changed = inter.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    const cases = [
      { fonts: required().map((f) => ({ ...f, bytes: undefined })), message: /is missing/ },
      { fonts: required().map((f) => ({ ...f, bytes: inter.slice(1) })), message: /does not match/ },
      { fonts: required().map((f) => ({ ...f, bytes: changed })), message: /does not match/ },
      // right hash and size for bytes that are no font: the face fails to load
      {
        fonts: [
          { ...required()[0], bytes: new Uint8Array(8), size: 8, sha256: await hex(new Uint8Array(8)), alias: artworkFontAlias(await hex(new Uint8Array(8))) },
        ],
        message: /could not be loaded/,
      },
    ];
    for (const { fonts: input, message } of cases) {
      const result = await registerArtworkFonts(input as never, ports);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error[0]?.message).toMatch(message);
    }
    const controller = new AbortController();
    controller.abort();
    expect((await registerArtworkFonts(required(), { ...ports, signal: controller.signal })).ok).toBe(false);
    await Promise.resolve();
    expect([...document.fonts].filter((face) => face.family.replace(/"/g, '').startsWith('fx-artwork-'))).toEqual([]);
  });

  it('releases faces that finished loading when cancelled before it returns', async () => {
    // one font: the first sample follows its hash check, the second follows the face loads
    const result = await registerArtworkFonts(required(), { ...ports, signal: abortedFrom(1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toMatch(/cancelled/);
    await Promise.resolve();
    expect(inSet(ALIAS)).toEqual([]);
  });

  it('copies the bytes before awaiting, so later changes to the input have no effect', async () => {
    const bytes = inter.slice();
    const pending = registerArtworkFonts(
      required().map((f) => ({ ...f, bytes })),
      ports,
    );
    bytes.fill(0);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) result.value.dispose();
  });
});

describe('registerSavedShapePacks and the shape view', () => {
  async function show(registries: ReturnType<typeof testRegistries> & { artworkFonts?: unknown }) {
    const builder = documentBuilder({ seed: 97 });
    const screenId = builder.screen({ size: { w: 400, h: 200 } });
    builder.rect(screenId, { defId: 'sample:label', x: 10, y: 10, w: 320, h: 160 });
    builder.text(screenId, 'API', { x: 10, y: 180, w: 300, h: 20 });
    const core = createCore(builder.build());
    await act(async () =>
      root.render(
        <ScreenView registries={registries as never} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 200 } }} />,
      ),
    );
  }
  /** Ink of "API" drawn on a canvas in `family`, which reads the page's font set like the content layer. */
  function ink(family: string): number[] {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 50;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.font = `400 40px ${family}`;
    context.fillText('API', 4, 40);
    return Array.from(context.getImageData(0, 0, 120, 50).data.filter((_, i) => i % 4 === 3));
  }

  it('draws bound artwork text in its exact face while same-family document text keeps the ordinary face', async () => {
    // an ordinary "Inter" that is really Roboto: the collision ADR-0192 guards against
    const ordinary = new FontFace('Inter', roboto.slice().buffer, { weight: '400', style: 'normal' });
    await ordinary.load();
    document.fonts.add(ordinary);
    extra.push(ordinary);
    const reference = new FontFace('FxReferenceInter', inter.slice().buffer, { weight: '400', style: 'normal' });
    await reference.load();
    document.fonts.add(reference);
    extra.push(reference);

    const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
    const registries = { ...testRegistries(), artworkFonts };
    const done = await registerSavedShapePacks(registries, [subset()], { ...ports, bytesOf: () => inter, policy: allowsShapePackContentLicense });
    if (!done.ok) throw new Error(JSON.stringify(done.error));
    await show(registries);
    const text = host.querySelector('.fx-artwork text');
    if (!(text instanceof SVGTextElement)) throw new Error('no artwork text');
    expect(text.getAttribute('font-family')).toBe(ALIAS);
    expect(getComputedStyle(text).fontFamily.replace(/"/g, '')).toBe(ALIAS);
    expect(subset().definitions[1]?.artwork?.root.children[0]).toMatchObject({ attributes: { 'font-family': 'Inter' } });

    const bound = ink(ALIAS);
    expect(bound).toEqual(ink('FxReferenceInter'));
    expect(bound).not.toEqual(ink('Inter'));
    expect(bound.some((alpha) => alpha > 0)).toBe(true);
    // the document's own text names the ordinary family, untouched
    expect([...host.querySelectorAll('.fx-text, [data-fx-text]')].every((el) => !getComputedStyle(el).fontFamily.includes('fx-artwork-'))).toBe(true);
    done.value.dispose();
    expect([registries.shapeDefs.get('sample:label'), artworkFonts.get('sample:label')]).toEqual([undefined, undefined]);
    await Promise.resolve();
  });

  it('refuses a pack whose bytes are missing: no face, definition or binding, so nothing draws in a fallback', async () => {
    const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
    const registries = { ...testRegistries(), artworkFonts };
    const before = registries.shapeDefs.list();
    const refused = await registerSavedShapePacks(registries, [subset()], { ...ports, bytesOf: () => undefined, policy: allowsShapePackContentLicense });
    expect(refused.ok).toBe(false);
    expect(registries.shapeDefs.list()).toEqual(before);
    expect(artworkFonts.list()).toEqual([]);
    expect(inSet(ALIAS)).toEqual([]);
  });

  it('checks the packs before reading any font: a denied, occupied or malformed pack loads no face (M18.115)', async () => {
    const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
    const registries = { ...testRegistries(), artworkFonts };
    registries.shapeDefs.register('taken:box', subset().definitions[0] as never, 'installed');
    let reads = 0;
    const bytesOf = () => {
      reads++;
      return inter;
    };
    const before = registries.shapeDefs.list();
    for (const [packs, policy] of [
      [[subset()], () => false],
      [[{ ...subset(), id: 'taken' }], allowsShapePackContentLicense],
      [[{ ...subset(), fontResources: 'none' }], allowsShapePackContentLicense],
    ] as const) {
      const refused = await registerSavedShapePacks(registries, packs as never, { ...ports, bytesOf, policy });
      expect(refused.ok).toBe(false);
    }
    expect(reads).toBe(0);
    expect(registries.shapeDefs.list()).toEqual(before);
    expect(artworkFonts.list()).toEqual([]);
    expect(inSet(ALIAS)).toEqual([]);
  });

  it('cancelled after its fonts load, registers no definition or binding and releases the faces', async () => {
    const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
    const registries = { ...testRegistries(), artworkFonts };
    const before = registries.shapeDefs.list();
    // the font registration's two samples pass; the third, before geometry registers, reads aborted
    const cancelled = await registerSavedShapePacks(registries, [subset()], {
      ...ports,
      bytesOf: () => inter,
      policy: allowsShapePackContentLicense,
      signal: abortedFrom(2),
    });
    expect(cancelled.ok).toBe(false);
    expect(registries.shapeDefs.list()).toEqual(before);
    expect(artworkFonts.list()).toEqual([]);
    await Promise.resolve();
    expect(inSet(ALIAS)).toEqual([]);
  });

  it('draws a bound definition as a placeholder when its binding no longer covers its text', async () => {
    const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
    const registries = { ...testRegistries(), artworkFonts };
    const def = subset().definitions[1];
    if (def === undefined) throw new Error('fixture');
    registries.shapeDefs.register(def.id, def, 'sample');
    artworkFonts.register(def.id, [{ family: 'Other', weight: 400, style: 'normal', sha256: SHA, alias: ALIAS }], 'sample');
    await show(registries);
    expect(host.querySelector('.fx-artwork')).toBeNull();
  });
});
