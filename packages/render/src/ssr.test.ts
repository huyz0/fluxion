import type { ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { CONTENT_CSS } from './content-css.js';
import { renderDocumentToHtml } from './ssr.js';
import { testRegistries } from './test-registries.js';
import { testShapeDefs } from './test-shapes.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the shared fixtures at the repo root (scripts/fixtures/gen.mjs)
const FIXTURES = import.meta.glob('../../../fixtures/docs/*.flux.json', { query: '?raw', import: 'default', eager: true });
const fixture = (name: string) => JSON.parse(FIXTURES[`../../../fixtures/docs/${name}.flux.json`] ?? '{}') as DocumentFile;

/** Three screens, the middle one hidden. */
function threeScreens() {
  const b = documentBuilder({ title: 'Deck <1> & "two"', seed: 416 });
  const ids = [b.screen({ name: 'one' }), b.screen({ name: 'two' }), b.screen({ name: 'three' })];
  b.rect(ids[0] as RecordId, { label: 'A' });
  const file = b.build();
  const hidden = ids[1] as RecordId;
  return { file: { ...file, records: { ...file.records, [hidden]: { ...(file.records[hidden] as object), hidden: true } } } as DocumentFile, ids };
}

describe('static HTML (FR-CLI-001, FR-THM-001, ADR-0015)', () => {
  it('FR-CLI-001: static HTML has no script and one .fx-screen per visible screen', () => {
    const { file, ids } = threeScreens();
    const html = renderDocumentToHtml(file, { registries: testRegistries() }).html;
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    const screens = [...html.matchAll(/<section class="fx-screen" data-screen-id="([^"]+)"/g)].map((m) => m[1]);
    // the hidden screen is skipped, the others keep document order
    expect(screens).toEqual([ids[0], ids[2]]);
    // a screen filter keeps only the requested screens
    expect([...renderDocumentToHtml(file, { registries: testRegistries(), screens: [ids[2] as RecordId] }).html.matchAll(/class="fx-screen"/g)]).toHaveLength(
      1,
    );
    // the title is the document's, escaped
    expect(html).toContain('<title>Deck &#60;1&#62; &#38; &#34;two&#34;</title>');
    // the same input gives the same bytes
    expect(renderDocumentToHtml(file, { registries: testRegistries() }).html).toBe(html);
    // the fixture's shapes and connector are drawn
    const fixtureHtml = renderDocumentToHtml(fixture('two-rects-line'), { registries: testRegistries() }).html;
    expect([...fixtureHtml.matchAll(/data-kind="shape"/g)]).toHaveLength(2);
    expect(fixtureHtml).toMatch(/data-kind="connector"[^>]*>(?:(?!<\/div>).)*class="fx-route"/s);
  });

  it('FR-CLI-001: renderDocumentToHtml reports the ids of the screens it rendered', () => {
    const { file, ids } = threeScreens();
    const all = renderDocumentToHtml(file, { registries: testRegistries() });
    // the visible screens in page order (the hidden one is not drawn), equal to what the page holds
    expect(all.screens).toEqual([ids[0], ids[2]]);
    expect([...all.html.matchAll(/data-screen-id="([^"]+)"/g)].map((m) => m[1])).toEqual(all.screens);
    expect(renderDocumentToHtml(file, { registries: testRegistries(), screens: [ids[2] as RecordId] }).screens).toEqual([ids[2]]);
    // asking for the hidden screen draws nothing
    expect(renderDocumentToHtml(file, { registries: testRegistries(), screens: [ids[1] as RecordId] }).screens).toEqual([]);
  });

  it('FR-THM-001: the static HTML inlines the content CSS and defines every --fx variable it uses', () => {
    const html = renderDocumentToHtml(fixture('two-rects-line'), { registries: testRegistries() }).html;
    expect(html).toContain(`<style data-fx-content>${CONTENT_CSS}</style>`);
    const used = new Set([...html.matchAll(/var\((--fx-[\w-]+)/g)].map((m) => m[1]));
    const defined = new Set([...html.matchAll(/(--fx-[\w-]+):/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(3);
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
    // the screen default and the shape defaults resolve through tokens
    expect(html).toContain('var(--fx-color-background');
    expect(html).toContain('var(--fx-color-surface');
  });

  it('FR-CLI-001: ids are unique on the page and every url(#id) points into its own screen (M4.16 review F1)', () => {
    const b = documentBuilder({ seed: 417 });
    for (const colour of ['#ff0000', '#0000ff']) {
      const s = b.screen();
      const fill = {
        type: 'linear-gradient' as const,
        angle: 0,
        stops: [
          { offset: 0, color: colour },
          { offset: 1, color: '#ffffff' },
        ],
      };
      b.connect(b.rect(s, { x: 0, y: 0, style: { fill } }), b.rect(s, { x: 400, y: 0 }));
    }
    const html = renderDocumentToHtml(b.build(), { registries: testRegistries() }).html;
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(ids.length);
    const screens = html.split('<section class="fx-screen"').slice(1);
    expect(screens).toHaveLength(2);
    for (const screen of screens) {
      const refs = [...screen.matchAll(/url\(#([^)"]+)\)/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThanOrEqual(2);
      for (const ref of refs) expect(screen).toContain(`id="${ref}"`);
    }
  });
});

describe('shapes from core definitions (ADR-0016, M5.9)', () => {
  it('FR-SHP-003: a shape draws its definition’s outline for its size and params; an unknown or failing one is a placeholder', () => {
    const defs = testShapeDefs();
    const inset: ShapeDef = {
      id: 'test:inset',
      params: { k: { type: 'number', min: 0, max: 50, default: 5 } },
      outline: { path: 'M {k} 0 L {w} {h} L 0 {h} Z' },
      defaultSize: { w: 10, h: 10 },
    };
    defs.register(inset.id, inset, 'test');
    defs.register('test:broken', { ...inset, id: 'test:broken', outline: { path: 'M {nope} 0' } }, 'test');
    const b = documentBuilder({ seed: 590 });
    const s = b.screen();
    b.rect(s, { defId: 'test:inset', x: 0, y: 0, w: 100, h: 40 });
    const tuned = b.rect(s, { defId: 'test:inset', x: 0, y: 100, w: 100, h: 40 });
    b.rect(s, { defId: 'test:broken', x: 0, y: 200 });
    b.rect(s, { defId: 'acme:unknown', x: 0, y: 300 });
    const file = b.build();
    const records = { ...file.records, [tuned]: { ...(file.records[tuned] as object), params: { k: 80 } } };
    const html = renderDocumentToHtml({ ...file, records } as DocumentFile, { registries: builtinRegistries(defs) }).html;
    const paths = [...html.matchAll(/class="fx-outline" d="([^"]+)"/g)].map((m) => m[1]);
    // the default param, then the element's own value clamped to the param's max
    expect(paths).toEqual(['M5 0 L100 40 L0 40 Z', 'M50 0 L100 40 L0 40 Z']);
    expect([...html.matchAll(/class="fx-placeholder"/g)]).toHaveLength(2);
  });
});

describe('shape views read their definition (ADR-0016 item 2, M5 cp1 F1)', () => {
  it("FR-SHP-004: a definition's default style applies under the element's style, and open outlines are stroked without fill", () => {
    const defs = testShapeDefs();
    const boxed: ShapeDef = {
      id: 'test:boxed',
      outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
      defaultSize: { w: 10, h: 10 },
      defaultStyle: { fill: '#ff0000', stroke: { width: 0 } },
    };
    const open: ShapeDef = { id: 'test:open', outline: { path: 'M 0 {h/2} L {w} {h/2}' }, defaultSize: { w: 10, h: 10 }, defaultStyle: { fill: '#ff0000' } };
    defs.register(boxed.id, boxed, 'test');
    defs.register(open.id, open, 'test');
    const b = documentBuilder({ seed: 591 });
    const s = b.screen();
    b.rect(s, { defId: 'test:boxed', x: 0, y: 0 });
    b.rect(s, { defId: 'test:boxed', x: 0, y: 200, style: { fill: '#00ff00' } });
    b.rect(s, { defId: 'test:open', x: 0, y: 400 });
    b.rect(s, { defId: 'basic:rect', x: 0, y: 600 });
    const html = renderDocumentToHtml(b.build(), { registries: builtinRegistries(defs) }).html;
    const styles = [...html.matchAll(/class="fx-outline" d="[^"]*" style="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(styles).toHaveLength(4);
    // the definition's fill and stroke width, where the element sets none
    expect(styles[0]).toContain('fill:#ff0000');
    expect(styles[0]).toContain('stroke-width:0');
    // the element's own fill wins; the definition's stroke width still applies
    expect(styles[1]).toContain('fill:#00ff00');
    expect(styles[1]).toContain('stroke-width:0');
    // an open outline is not filled, whatever its style says
    expect(styles[2]).toContain('fill:none');
    // a definition without defaults: the theme's
    expect(styles[3]).toContain('fill:var(--fx-color-surface');
  });
});
