// NFR-SIZE-005: layout engines are not embedded in a saved file; computed positions are baked. The saved `.flux.html` is the `.flux` archive plus the one-file
// player (`@fluxion/player-inline`'s build output, which `pnpm build` makes before the tests run), so the player's text is checked for the layout engine, and so
// is a whole `.flux.html` written from a document that was laid out (its screen carries a `layered` layout spec and the boxes the layout baked).
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { writeFluxHtml } from './flux-html.js';
import { writeFlux } from './flux-writer.js';
import { sha256Hex } from './index.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const PLAYER = Object.values(import.meta.glob('../../player-inline/dist/player.inline.js', { query: '?raw', import: 'default', eager: true }))[0];
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };

/** Names that only the layout engine (the `layered` algorithm over dagre, the pipeline, the worker glue) brings into a bundle. */
const ENGINE = [
  'dagre',
  'graphlib',
  'network-simplex',
  'tight-tree',
  'layoutSync',
  'registerBuiltInLayouts',
  'LAYOUT_INPUT_INVALID',
  'serveLayoutWorker',
] as const;
const found = (text: string): string[] => ENGINE.filter((name) => text.includes(name));

describe('no layout engine in a saved file (NFR-SIZE-005)', () => {
  it('NFR-SIZE-005: the one-file player and a saved .flux.html of a laid-out document hold no layout engine code', async () => {
    if (PLAYER === undefined) throw new Error('packages/player-inline/dist/player.inline.js is missing: run `pnpm build` first');
    expect(found(PLAYER)).toEqual([]);
    // a document laid out by `layered`: the screen keeps the layout spec as data and the elements keep the boxes the layout baked
    const b = documentBuilder({ seed: 1305 });
    const screen = b.screen({ size: { w: 1920, h: 1080 } });
    b.rect(screen, { x: 80, y: 80, w: 160, h: 80 });
    b.rect(screen, { x: 80, y: 184, w: 160, h: 80 });
    const document = b.build();
    for (const record of Object.values(document.records)) if (record.type === 'screen') (record as { layout?: unknown }).layout = { type: 'layered' };
    const flux = await writeFlux({ document, appVersion: '0.0.0', hasher });
    if (!flux.ok) throw new Error('the document did not write');
    const html = await writeFluxHtml({ flux: flux.value, playerScript: PLAYER, title: 'Laid out', hasher });
    if (!html.ok) throw new Error('the html did not write');
    expect(found(html.value)).toEqual([]);
    // the check sees what it should: the engine's names are found in a text that holds them
    expect(found(`${PLAYER}\nconst x = layoutSync(dagre);`)).toEqual(['dagre', 'layoutSync']);
  });
});
