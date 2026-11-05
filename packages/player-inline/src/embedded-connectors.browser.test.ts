// The pack connector types a presented file embeds (M18.147, FR-CON-010, FR-LIB-009), through the built one-file player as a
// `.flux.html` runs it: the element opens a `.flux` through the same openFlux.
import { type ContentHasher, writeFlux } from '@fluxion/format';
import type { DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  interface Window {
    /** The global the built script defines. */
    Fluxion?: { start(bytes: Uint8Array, root: HTMLElement): Promise<{ ok: boolean; message?: string; unmount?: () => void }> };
  }
}

const raw = (glob: Record<string, string>) => Object.values(glob)[0];
// the built one-file player and its routing chunk (`pnpm build` writes them)
const BUNDLE = raw(import.meta.glob('../dist/player.inline.js', { query: '?raw', import: 'default', eager: true }));
const ROUTING = raw(import.meta.glob('../dist/fluxion-routing.js', { query: '?raw', import: 'default', eager: true }));
// the first-party arrows pack's connector types, as a save embeds them
const ARROWS = raw(import.meta.glob('../../../packs/arrows/pack/connectors.json', { query: '?raw', import: 'default', eager: true }));

const hasher: ContentHasher = {
  async sha256(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  },
};
const SLOW = { timeout: 15_000 };

/** One screen where a connector of type `route` runs between two shapes past a wall, with `entries` as the file's extra entries. */
async function walledFile(route: `${string}:${string}`, entries: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const b = documentBuilder({ seed: 68, title: 'Walled' });
  const screen = b.screen({ name: 'walled', size: { w: 1600, h: 900 } });
  const a = b.rect(screen, { x: 100, y: 400, w: 120, h: 80 });
  b.rect(screen, { x: 600, y: 200, w: 60, h: 500 });
  const c = b.rect(screen, { x: 1100, y: 400, w: 120, h: 80 });
  b.connect(a, c, { route });
  const zip = await writeFlux({ document: b.build() as DocumentFile, appVersion: '0', hasher, extraEntries: entries });
  if (!zip.ok) throw new Error(zip.error.reason);
  return zip.value;
}
const entry = (text: string) => new Map([['connectors/arrows.json', new TextEncoder().encode(text)]]);

let root: HTMLElement;
beforeAll(() => {
  if (BUNDLE === undefined || ROUTING === undefined) throw new Error('packages/player-inline/dist is missing: run `pnpm build` first');
  const script = document.createElement('script');
  script.textContent = BUNDLE;
  document.head.append(script);
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => root.remove());

describe('embedded pack connector types in the player (FR-CON-010, FR-LIB-009; M18.147)', { timeout: 60_000 }, () => {
  const connectors = () => root.querySelectorAll('svg.fx-connector');
  // the decoration strokes of the drawn connectors (`data-part`): none for a plain route
  const decorations = () => root.querySelectorAll('svg.fx-connector [data-part]').length;

  it('FR-CON-010, FR-LIB-009: an embedded type is registered on open, drawn with its decoration and routed by the routing worker', async () => {
    if (ARROWS === undefined) throw new Error('packs/arrows/pack/connectors.json is missing');
    // the routing chunk as a `.flux.html` carries it: an inert data block the player runs as a worker
    const block = document.createElement('script');
    block.type = 'text/plain';
    block.dataset['fluxionChunk'] = 'routing';
    block.textContent = ROUTING ?? '';
    document.body.append(block);
    try {
      const result = await window.Fluxion?.start(await walledFile('arrows:cable', entry(ARROWS)), root);
      expect(result?.ok, result?.message).toBe(true);
      // the cable's base is orthogonal: the worker's pass takes it in and goes around the wall, and its decoration is drawn
      await vi.waitFor(() => expect(root.getAttribute('data-routes')).toBe('settled'), SLOW);
      await vi.waitFor(() => expect([...connectors()].map((c) => c.getAttribute('data-route-pass'))).toEqual(['global']), SLOW);
      expect(decorations()).toBeGreaterThan(0);
      result?.unmount?.();
    } finally {
      block.remove();
    }
  });

  it('FR-CON-010, FR-LIB-009: a refused entry opens the file, its connector drawn as an unknown type', async () => {
    // the entry names a base router that does not exist: refused whole
    const def = { id: 'arrows:cable', name: 'Cable', describe: 'A cable.', router: 'nowhere', decoration: { kind: 'cable', pitch: 10 } };
    const result = await window.Fluxion?.start(await walledFile('arrows:cable', entry(JSON.stringify({ definitions: [def] }))), root);
    expect(result?.ok, result?.message).toBe(true);
    await vi.waitFor(() => expect(connectors().length).toBe(1), SLOW);
    expect(decorations()).toBe(0);
    result?.unmount?.();
  });
});
