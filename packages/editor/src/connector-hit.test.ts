import { createCore, createRegistry, type MarkerDef } from '@fluxion/core';
import { type Router, registerBuiltinRouters } from '@fluxion/routing';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { registries } from './__fixtures__/hit-shapes.js';
import { LABEL_MAX_W } from './connector-hit.js';
import { createHitIndex } from './hit-test.js';

const ARROW: MarkerDef = { id: 'arrow', path: 'M0 0 L10 5 L0 10 Z', inset: 7, filled: true };

/** A straight connector from (100, 100) to (500, 100), 2 px wide (theme), with `fields` patched in. */
function setup(fields: Record<string, unknown>, withMarkers = true) {
  const b = documentBuilder({ seed: 180 });
  const screen = b.screen({ size: { w: 1000, h: 1000 } });
  const link = b.connect({ x: 100, y: 100 }, { x: 500, y: 100 });
  const core = createCore(b.build());
  const patched = core.store.transact('fields', (tx) => tx.patch(link, fields));
  if (!patched.ok) throw new Error(JSON.stringify(patched.error));
  const markers = createRegistry<string, MarkerDef>('markers');
  markers.register(ARROW.id, ARROW, 'test');
  const hits = createHitIndex(core.store, { registries: { ...registries(), ...(withMarkers ? { markers } : {}) }, theme: LIGHT_THEME });
  const at = (x: number, y: number) => hits.hitTest(screen, { x, y }, 1);
  return { screen, link, hits, at, markers };
}

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: t === '' ? [] : [{ type: 'text', text: t }] }] });

describe('connector hit-testing (FR-EDT-004)', () => {
  it('FR-EDT-004: a connector`s registered markers are hit within 5 stroke widths of where they are drawn', () => {
    const { link, at } = setup({ markers: { start: 'acme:nope', end: 'arrow', mid: 'arrow' } });
    // the route ends at x 500; its arrow is drawn 10 px (5 × 2 px) about there, plus the 4 px pick margin
    expect([at(513, 100), at(515, 100), at(500, 113), at(500, 115)]).toEqual([link, undefined, link, undefined]);
    // an unregistered marker is not drawn: the start is hit by its stroke only (1 px + 4 px)
    expect([at(96, 100), at(90, 100)]).toEqual([link, undefined]);
    // the middle marker, at the route's middle
    expect([at(300, 113), at(300, 115), at(200, 113)]).toEqual([link, undefined, undefined]);
  });

  it('FR-EDT-004: without a markers registry, markers are not hit beyond the route', () => {
    const { link, at } = setup({ markers: { end: 'arrow' } }, false);
    expect([at(504, 100), at(506, 100)]).toEqual([link, undefined]);
  });

  it('FR-EDT-004: a connector`s labels are hit on their estimated text box at their place along the route', () => {
    const { screen, link, at, hits } = setup({
      markers: {},
      labels: [
        { text: text('Hello'), position: 0.5, offset: { x: 0, y: -40 } },
        { text: text(''), position: 0.1, offset: { x: 0, y: 60 } },
      ],
    });
    // "Hello" in 18 px type (1.3 line height): 62 × 25.4 about (300, 60), plus the pick margin
    expect([at(300, 60), at(334, 60), at(336, 60), at(300, 44), at(300, 42)]).toEqual([link, link, undefined, link, undefined]);
    // an empty label draws nothing
    expect(at(140, 160)).toBeUndefined();
    // a marquee over the label alone picks the connector; one beside it does not
    expect(hits.within(screen, { x: 290, y: 50, w: 20, h: 20 }, 'intersect')).toEqual([link]);
    expect(hits.within(screen, { x: 340, y: 50, w: 20, h: 20 }, 'intersect')).toEqual([]);
  });

  it('FR-EDT-004: a long label is at most as wide as it is drawn; a marquee near a marker picks it', () => {
    const { screen, link, at, hits } = setup({
      markers: { end: 'arrow' },
      labels: [{ text: text('x'.repeat(200)), position: 0.5, offset: { x: 0, y: -100 } }],
    });
    expect(LABEL_MAX_W).toBe(240);
    expect([at(300 + 124, 0), at(300 + 126, 0)]).toEqual([link, undefined]);
    expect(hits.within(screen, { x: 506, y: 95, w: 5, h: 10 }, 'intersect')).toEqual([link]);
    expect(hits.within(screen, { x: 512, y: 95, w: 5, h: 10 }, 'intersect')).toEqual([]);
    // a marquee box containing the whole connector, label and arrow included
    expect(hits.within(screen, { x: 50, y: -20, w: 520, h: 140 }, 'contain')).toEqual([link]);
    expect(hits.within(screen, { x: 50, y: 50, w: 520, h: 70 }, 'contain')).toEqual([]);
  });
});

describe('connector hit-testing, edges (FR-EDT-004)', () => {
  it('FR-EDT-004: a start marker widens the index bounds backwards; a marquee is picked at a marker`s reach on every side', () => {
    const { screen, link, at, hits } = setup({ markers: { start: 'arrow' } });
    // the start's arrow reaches back past the route's start, beyond the stroke's own bounds
    expect([at(87, 100), at(85, 100)]).toEqual([link, undefined]);
    // marquees left of, above and below the start's arrow: within its 10 px reach, or just beyond
    const pick = (x: number, y: number, w: number, h: number) => hits.within(screen, { x, y, w, h }, 'intersect');
    expect([pick(85, 95, 5, 10), pick(80, 95, 5, 10)]).toEqual([[link], []]);
    expect([pick(97, 80, 5, 11), pick(97, 80, 5, 8)]).toEqual([[link], []]);
    expect([pick(97, 109, 5, 5), pick(97, 112, 5, 5)]).toEqual([[link], []]);
  });

  it('FR-EDT-004: a label is picked by a marquee touching its box, not by one beside it within the bounds', () => {
    const { screen, link, hits } = setup({
      markers: { end: 'arrow' },
      labels: [
        { text: text('Hello'), position: 0.5, offset: { x: 0, y: -40 } },
        { text: text('Up'), position: 0.5, offset: { x: 0, y: -140 } },
      ],
    });
    const pick = (x: number, y: number, w: number, h: number) => hits.within(screen, { x, y, w, h }, 'intersect');
    // "Hello" spans x 269-331 (62 px), y 47.3-72.7: touching an edge picks it
    expect([pick(331, 55, 5, 5), pick(264, 55, 5, 5), pick(265, 50, 10, 10)]).toEqual([[link], [link], [link]]);
    // beside it, above it (between the labels) and below it (above the route): nothing drawn there
    expect([pick(200, 50, 10, 10), pick(290, 20, 10, 10), pick(290, 80, 10, 10), pick(450, 40, 10, 10)]).toEqual([[], [], [], []]);
  });

  it('FR-EDT-004: a label of several paragraphs is as wide as its longest, and an empty paragraph does not hide it', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
      ],
    };
    const { link, at } = setup({ markers: {}, labels: [{ text: doc, position: 0.5, offset: { x: 0, y: -80 } }] });
    // 11 characters: 11 × 0.6 × 18 + 8 = 126.8 wide, about x 300; three lines high
    expect([at(300 + 63 + 3, 20), at(300 + 63 + 5, 20)]).toEqual([link, undefined]);
  });

  it('FR-EDT-004: an end marker sits at the route`s last point, after its bends', () => {
    const b = documentBuilder({ seed: 182 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const link = b.connect({ x: 100, y: 100 }, { x: 500, y: 300 }, { route: 'orthogonal' });
    const core = createCore(b.build());
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    const markers = createRegistry<string, MarkerDef>('markers');
    markers.register(ARROW.id, ARROW, 'test');
    const hits = createHitIndex(core.store, { registries: { ...registries(), routers, markers }, theme: LIGHT_THEME });
    // off the route near its end, within the arrow's reach
    expect([hits.hitTest(screen, { x: 509, y: 309 }, 1), hits.hitTest(screen, { x: 512, y: 312 }, 1)]).toEqual([link, undefined]);
  });

  it('FR-EDT-004: a label box`s top and bottom edges are part of it', () => {
    // 20 px type, 1.5 line height: "Hi" is 32 × 32 about (300, 60), y 44-76
    const { screen, link, hits } = setup({
      markers: {},
      style: { font: { size: 20, lineHeight: 1.5 } },
      labels: [{ text: text('Hi'), position: 0.5, offset: { x: 0, y: -40 } }],
    });
    const pick = (y: number, h: number) => hits.within(screen, { x: 290, y, w: 5, h }, 'intersect');
    expect([pick(76, 5), pick(39, 5), pick(77, 5)]).toEqual([[link], [link], []]);
  });
});
