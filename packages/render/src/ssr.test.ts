import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { CONTENT_CSS } from './content-css.js';
import { renderDocumentToHtml } from './ssr.js';

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
    const html = renderDocumentToHtml(file);
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    const screens = [...html.matchAll(/<section class="fx-screen" data-screen-id="([^"]+)"/g)].map((m) => m[1]);
    // the hidden screen is skipped, the others keep document order
    expect(screens).toEqual([ids[0], ids[2]]);
    // a screen filter keeps only the requested screens
    expect([...renderDocumentToHtml(file, { screens: [ids[2] as RecordId] }).matchAll(/class="fx-screen"/g)]).toHaveLength(1);
    // the title is the document's, escaped
    expect(html).toContain('<title>Deck &#60;1&#62; &#38; &#34;two&#34;</title>');
    // the same input gives the same bytes
    expect(renderDocumentToHtml(file)).toBe(html);
    // the fixture's shapes and connector are drawn
    const fixtureHtml = renderDocumentToHtml(fixture('two-rects-line'));
    expect([...fixtureHtml.matchAll(/data-kind="shape"/g)]).toHaveLength(2);
    expect(fixtureHtml).toMatch(/data-kind="connector"[^>]*>(?:(?!<\/div>).)*class="fx-route"/s);
  });

  it('FR-THM-001: the static HTML inlines the content CSS and defines every --fx variable it uses', () => {
    const html = renderDocumentToHtml(fixture('two-rects-line'));
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
    const html = renderDocumentToHtml(b.build());
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
