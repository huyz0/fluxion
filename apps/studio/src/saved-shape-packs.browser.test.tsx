// FR-LIB-004 FR-AST-003: the studio registers a file's saved packs, their exact artwork fonts first, before it shows the document, and
// refuses one whose bytes are missing (ADR-0192, M18.115).
import { allowsShapePackContentLicense, artworkFontAlias, parseVersionedShapePackSubset, type VersionedShapePackSubset } from '@fluxion/core';
import { type Result, seededRandom } from '@fluxion/schema';
import { act, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { type OpenDocument, openDocument, registerOpenedShapePacks } from './bootstrap.js';
import { loadDocument } from './documents.js';
import { webHasher } from './file-session.js';
import { type SavedPacksState, useSavedShapePacks } from './saved-shape-packs.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url' | '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const json = Object.values(import.meta.glob('../../../fixtures/shape-pack/v1.1/subset.json', { query: '?raw', import: 'default', eager: true }))[0];
const url = Object.values(
  import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
)[0];
const SHA = '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc';
const ALIAS = artworkFontAlias(SHA);
const inter = async () => new Uint8Array(await (await fetch(url ?? '')).arrayBuffer());
const aliased = () => [...document.fonts].filter((face) => face.family.replaceAll('"', '') === ALIAS);
function packs(): readonly VersionedShapePackSubset[] {
  const parsed = parseVersionedShapePackSubset(JSON.parse(json ?? 'null'), allowsShapePackContentLicense);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return [parsed.value];
}
function opened(): OpenDocument {
  const file = loadDocument('new', seededRandom(1));
  if (!file.ok) throw new Error(file.error);
  const doc = openDocument(file.value);
  if (!doc.ok) throw new Error(doc.error);
  return doc.value;
}
const ports = { sha256: (b: Uint8Array) => webHasher.sha256(b) };

describe('saved packs with retained artwork fonts in the studio (M18.115)', () => {
  it('FR-AST-003: registers geometry, bindings and the exact face under its alias, and releases all three with the file', async () => {
    const doc = opened();
    const done = await registerOpenedShapePacks(doc, packs(), new Map([[SHA, await inter()]]), ports);
    if (!done.ok) throw new Error(done.error);
    expect(doc.registries.shapeDefs.get('sample:label')?.id).toBe('sample:label');
    expect(doc.registries.artworkFonts?.get('sample:label')?.map((b) => b.alias)).toEqual([ALIAS]);
    expect(aliased().map((face) => face.status)).toEqual(['loaded']);
    done.value.dispose();
    await Promise.resolve();
    expect([doc.core.registries.shapeDefs.get('sample:label'), doc.artworkFonts.list(), aliased()]).toEqual([undefined, [], []]);
  });

  it('FR-LIB-004: refuses packs whose bytes are missing or changed, leaving no face, definition or binding', async () => {
    const changed = await inter();
    changed[100] = (changed[100] ?? 0) ^ 1;
    for (const fonts of [new Map<string, Uint8Array>(), new Map([[SHA, changed]])]) {
      const doc = opened();
      const refused = await registerOpenedShapePacks(doc, packs(), fonts, ports);
      expect(refused.ok ? '' : refused.error).toMatch(/^The saved shapes could not be registered: artwork font 8909904a/);
      expect([doc.core.registries.shapeDefs.get('sample:label'), doc.artworkFonts.list(), aliased()]).toEqual([undefined, [], []]);
    }
  });

  it('FR-LIB-004: the page waits while the packs register, then shows the document; a refusal is shown instead; leaving releases the face', async () => {
    const seen: string[] = [];
    function Probe(props: { readonly doc: Result<OpenDocument, string>; readonly fonts: ReadonlyMap<string, Uint8Array> }): JSX.Element {
      const state: SavedPacksState = useSavedShapePacks(props.doc, saved, props.fonts);
      seen.push(state.phase === 'refused' ? `refused: ${state.message.slice(0, 40)}` : state.phase);
      return <p>{state.phase}</p>;
    }
    const saved = packs();
    const host = document.createElement('div');
    const root = createRoot(host);
    const fonts = new Map([[SHA, await inter()]]);
    const doc = { ok: true, value: opened() } as const;
    await act(async () => root.render(<Probe doc={doc} fonts={fonts} />));
    await expect.poll(() => seen.at(-1)).toBe('ready');
    expect(seen[0]).toBe('registering');
    expect(aliased().length).toBe(1);
    await act(async () => root.render(<Probe doc={{ ok: true, value: opened() }} fonts={new Map()} />));
    await expect.poll(() => seen.at(-1)).toBe('refused: The saved shapes could not be registered');
    // the first file's registration left with it
    expect(aliased()).toEqual([]);
    act(() => root.unmount());
  });
});
