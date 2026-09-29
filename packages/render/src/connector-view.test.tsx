import type { DocumentFile, RecordId, Route, Style } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { strokeReach } from './shape-view.js';
import { renderDocumentToHtml } from './ssr.js';
import { testRegistries } from './test-registries.js';

/** The static HTML of one orthogonal connector from (0, 0) to (200, 100) with `route` and `style`: its path's `d` and style, and its SVG's style. */
function drawn(route: Partial<Route>, style?: Style, extra: Record<string, unknown> = {}) {
  const b = documentBuilder({ seed: 521 });
  b.screen({ size: { w: 400, h: 300 } });
  const id = b.connect({ x: 0, y: 0 }, { x: 200, y: 100 }, { route: 'orthogonal', arrow: false });
  const file = b.build();
  const connector = {
    ...(file.records[id as RecordId] as object),
    route: { type: 'orthogonal', ...route },
    ...(style === undefined ? {} : { style }),
    ...extra,
  };
  const html = renderDocumentToHtml({ ...file, records: { ...file.records, [id]: connector } } as DocumentFile, { registries: testRegistries() }).html;
  const path = /<path class="fx-route" d="([^"]*)" style="([^"]*)"/.exec(html);
  const svg = /<svg class="fx-connector"[^>]*style="([^"]*)"/.exec(html);
  return { d: path?.[1] ?? '', style: path?.[2] ?? '', box: svg?.[1] ?? '', html };
}

describe('connector style (FR-CON-005)', () => {
  it('FR-CON-005: rounded corners render with given radius', () => {
    // right, down halfway, right: two bends at (100, 0) and (100, 100), each a quarter circle of radius 10
    const k = 0.5523; // the cubic's control distance for a quarter circle, times the radius
    expect(drawn({}).d).toBe('M0 0 L100 0 L100 100 L200 100');
    const rounded = drawn({ cornerRadius: 10 }).d;
    expect(rounded).toBe(`M0 0 L90 0 C${90 + 10 * k} 0 100 ${10 - 10 * k} 100 10 L100 90 C100 ${90 + 10 * k} ${110 - 10 * k} 100 110 100 L200 100`);
    // a radius larger than half a segment is capped there: the 100 px vertical leg takes 50 at each end
    expect(drawn({ cornerRadius: 500 }).d).toBe('M0 0 L50 0 C77.614 0 100 22.386 100 50 L100 50 C100 77.614 122.386 100 150 100 L200 100');
    // without a route radius the style's corner radius applies, token refs included
    expect(drawn({}, { radius: 10 }).d).toBe(rounded);
    expect(drawn({}, { radius: '{radius.md}' }).d).toBe(drawn({ cornerRadius: 8 }).d);
    expect(drawn({ cornerRadius: 0 }, { radius: 10 }).d).toBe('M0 0 L100 0 L100 100 L200 100');
  });

  it('FR-CON-005: stroke colour, width, dash, cap, join and opacity come from the resolved style', () => {
    const { style } = drawn({}, { stroke: { color: '#ff0000', width: 3, dash: [6, 3], cap: 'round', join: 'bevel' } });
    expect(style).toContain('stroke:#ff0000');
    expect(style).toContain('stroke-width:3');
    expect(style).toContain('stroke-dasharray:6 3');
    expect(style).toContain('stroke-linecap:round');
    expect(style).toContain('stroke-linejoin:bevel');
    // opacity applies to the whole drawing, its SVG
    expect(drawn({}, { opacity: 0.5 }).box).toContain('opacity:0.5');
    // a token ref becomes the theme's CSS variable
    expect(drawn({}, { stroke: { color: '{color.primary}' } }).style).toMatch(/stroke:var\(--fx-color-primary/);
  });
});

describe('connector markers and labels in static HTML (FR-CON-003, FR-CON-006)', () => {
  it('FR-CON-006: labels render at their fractions of the drawn route as plain paragraphs', () => {
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const labels = [
      { text: { type: 'doc', content: [para('A'), para('B')] }, position: 0.5 },
      { text: { type: 'doc', content: [para('C')] }, position: 1, offset: { x: 4, y: -6 } },
    ];
    const { html } = drawn({}, undefined, { labels });
    // the route is 300 px long: halfway is the middle of its vertical leg
    expect(html).toMatch(/<div class="fx-connector-label" style="[^"]*left:100px;top:50px"><p>A<\/p><p>B<\/p><\/div>/);
    expect(html).toMatch(/<div class="fx-connector-label" style="[^"]*left:204px;top:94px"><p>C<\/p><\/div>/);
    // no labels, none drawn
    expect(drawn({}).html).not.toContain('<div class="fx-connector-label"');
  });

  it('FR-CON-003: end markers are defined only for the ends that have one', () => {
    const both = drawn({}, undefined, { markers: { start: 'arrow', end: 'arrow' } }).html;
    expect(both).toMatch(/marker-start="url\(#fx-marker-[\w-]+-start\)"/);
    expect(both).toMatch(/marker-end="url\(#fx-marker-[\w-]+-end\)"/);
    const start = drawn({}, undefined, { markers: { start: 'arrow' } }).html;
    expect(start).toContain('marker-start=');
    expect(start).toMatch(/<marker id="fx-marker-[\w-]+-start"/);
    expect(start).not.toContain('marker-end=');
    const none = drawn({}).html;
    expect(none).not.toContain('<defs>');
    expect(none).not.toContain('marker-');
  });
});

describe('shape effects region (M5.34 review F1)', () => {
  it('FR-SHP-004: the effects region covers how far the stroke reaches: miter joins, outside strokes, square caps', () => {
    // SVG's miter limit is 4 half-widths; an outside stroke's half-width is its full width
    expect(strokeReach(8, 'center', 'miter')).toBe(16);
    expect(strokeReach(8, 'outside', 'miter')).toBe(32);
    expect(strokeReach(8, 'inside', 'round')).toBe(4 * Math.SQRT2);
    expect(strokeReach(8, 'outside', 'bevel')).toBe(8 * Math.SQRT2);
  });
});
