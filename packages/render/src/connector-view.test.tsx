import { MARKER_SIZE, markerTrim } from '@fluxion/core';
import type { DocumentFile, RecordId, Route, Style } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { CONTENT_CSS } from './content-css.js';
import { BUILTIN_MARKERS } from './markers.js';
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
  it("FR-CON-006: a label's background is its screen's colour, not the theme's (M5.22 review F1)", () => {
    const onScreen = (background: unknown) => {
      const b = documentBuilder({ seed: 5241 });
      const screenId = b.screen();
      b.connect({ x: 0, y: 0 }, { x: 100, y: 0 }, { arrow: false });
      const file = b.build();
      const screen = { ...(file.records[screenId as string] as object), background };
      return renderDocumentToHtml({ ...file, records: { ...file.records, [screenId as string]: screen } } as DocumentFile, { registries: testRegistries() })
        .html;
    };
    expect(onScreen('#0f172a')).toMatch(/<section class="fx-screen"[^>]*style="[^"]*--fx-screen-background:#0f172a/);
    // a gradient has no one colour: the label keeps no background
    expect(
      onScreen({
        type: 'linear-gradient',
        angle: 0,
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      }),
    ).toMatch(/<section class="fx-screen"[^>]*style="[^"]*--fx-screen-background:transparent/);
    expect(CONTENT_CSS).toContain('background: var(--fx-screen-background, transparent)');
  });

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

  it('FR-CON-003: every marker scales with the stroke width and trims the path under it', () => {
    // a straight route from (0, 0) to (200, 0) with the marker at both ends, at two stroke widths
    for (const def of BUILTIN_MARKERS) {
      for (const width of [2, 4]) {
        const { d, html } = drawn({ type: 'straight' }, { stroke: { width } }, { freeTarget: { x: 200, y: 0 }, markers: { start: def.id, end: def.id } });
        // sized in stroke widths: the marker box is MARKER_SIZE stroke widths whatever the width
        const marker = new RegExp(
          `<marker id="fx-marker-[\\w-]+-end" viewBox="0 0 10 10" refX="${10 - def.inset}" refY="5" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" markerUnits="strokeWidth" orient="auto-start-reverse" overflow="visible">`,
        );
        expect(html, def.id).toMatch(marker);
        // filled with the stroke colour
        expect(html).toContain(`<path d="${def.path}" style="fill:var(--fx-color-connector);stroke:none"></path>`);
        // the line stops `inset` box units (MARKER_SIZE / 10 stroke widths each) back from each end
        const trim = (def.inset * MARKER_SIZE * width) / 10;
        expect(d, `${def.id} at ${width}`).toBe(`M${trim} 0 L${200 - trim} 0`);
        expect(markerTrim(def, width)).toBe(trim);
      }
    }
    expect(BUILTIN_MARKERS.map((m) => m.id)).toEqual(['arrow', 'triangle', 'diamond', 'circle', 'bar']);
    expect(markerTrim(undefined, 4)).toBe(0);
    // an end segment shorter than the trim (review F1): the trim takes half of it, and the reference
    // point moves toward the tip so the tip still lands on the end, along the segment's direction
    const short = drawn(
      { type: 'polyline', waypoints: [{ x: 190, y: 0 }] },
      { stroke: { width: 5 } },
      { freeTarget: { x: 200, y: 0 }, markers: { end: 'triangle' } },
    );
    expect(short.d).toBe('M0 0 L190 0 L195 0');
    // 5 px of a 2.5 px box unit: 2 units back from the tip
    expect(short.html).toMatch(/<marker id="fx-marker-[\w-]+-end" viewBox="0 0 10 10" refX="8"/);
    // a stroke of no width: no trim, the marker's own inset as its reference
    const hairline = drawn({ type: 'straight' }, { stroke: { width: 0 } }, { freeTarget: { x: 200, y: 0 }, markers: { end: 'triangle' } });
    expect(hairline.d).toBe('M0 0 L200 0');
    expect(hairline.html).toMatch(/refX="0"/);
    // an open marker is stroked as wide as the connector: 10 box units span MARKER_SIZE stroke widths
    const registries = testRegistries();
    registries.markers.register('test:open', { id: 'test:open', path: 'M0 0 L10 5 L0 10', inset: 0, filled: false }, 'test');
    const b = documentBuilder({ seed: 5201 });
    b.screen();
    b.connect({ x: 0, y: 0 }, { x: 100, y: 0 }, { arrow: false });
    const file = b.build();
    const [id] = Object.entries(file.records).find(([, r]) => (r as { kind?: string }).kind === 'connector') ?? [];
    const opened = {
      ...file,
      records: { ...file.records, [id as string]: { ...(file.records[id as string] as object), markers: { end: 'test:open' } } },
    } as DocumentFile;
    const open = renderDocumentToHtml(opened, { registries }).html;
    expect(open).toContain('refX="10"');
    expect(open).toContain(
      `<path d="M0 0 L10 5 L0 10" style="fill:none;stroke:var(--fx-color-connector);stroke-width:${10 / MARKER_SIZE};stroke-linejoin:bevel;stroke-linecap:butt"></path>`,
    );
    // none, and an unregistered marker, draw nothing and trim nothing
    const none = drawn({ type: 'straight' }, undefined, { freeTarget: { x: 200, y: 0 }, markers: { start: 'none', end: 'test:missing' } });
    expect(none.d).toBe('M0 0 L200 0');
    expect(none.html).not.toContain('<marker');
  });

  it("FR-CON-003: a mid marker sits at the route's midpoint, turned along it", () => {
    // the orthogonal route M0 0 L100 0 L100 100 L200 100 is 300 px long: halfway is (100, 50), heading down
    const at2 = drawn({}, { stroke: { width: 2 } }, { markers: { mid: 'arrow' } }).html;
    expect(at2).toContain(
      '<g class="fx-mid-marker" transform="translate(100 50) rotate(90) scale(1) translate(-5 -5)"><path d="M0 0 L10 5 L0 10 L3 5 Z" style="fill:var(--fx-color-connector);stroke:none"></path></g>',
    );
    // sized in stroke widths like the end markers
    expect(drawn({}, { stroke: { width: 4 } }, { markers: { mid: 'arrow' } }).html).toContain(
      'transform="translate(100 50) rotate(90) scale(2) translate(-5 -5)"',
    );
    // a straight route to the left turns it half round; no mid marker, or an unregistered one, draws none
    expect(drawn({ type: 'straight' }, undefined, { freeTarget: { x: -200, y: 0 }, markers: { mid: 'diamond' } }).html).toContain(
      'transform="translate(-100 0) rotate(180) scale(1) translate(-5 -5)"',
    );
    expect(drawn({}).html).not.toContain('<g class="fx-mid-marker"');
    expect(drawn({}, undefined, { markers: { mid: 'test:missing' } }).html).not.toContain('<g class="fx-mid-marker"');
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
