import { createCore, createRegistry, type MarkerDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { type Router, registerBuiltinRouters, routeConnector } from '@fluxion/routing';
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
  it('FR-EDT-004: a connector`s registered markers are hit where they are drawn: from the tip back along the route', () => {
    const { link, at } = setup({ markers: { start: 'acme:nope', end: 'arrow', mid: 'arrow' } });
    // the route ends at x 500; its arrow is drawn back from there, 10 px long and 10 px across (5 × 2 px):
    // hit beside the route within 5 + 4 px, and not in front of its tip beyond the stroke
    expect([at(495, 108), at(495, 110), at(506, 100), at(486, 108), at(484, 108)]).toEqual([link, undefined, undefined, link, undefined]);
    // an unregistered marker is not drawn: the start is hit by its stroke only (1 px + 4 px)
    expect([at(105, 108), at(96, 100), at(90, 100)]).toEqual([undefined, link, undefined]);
    // the middle marker, about the route's middle: 5 px each way along it
    expect([at(300, 108), at(300, 110), at(291, 108), at(289, 108)]).toEqual([link, undefined, link, undefined]);
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
    // the arrow's box spans y 95-105 behind the tip: a marquee just below it, or just clear of it
    expect(hits.within(screen, { x: 492, y: 105, w: 4, h: 4 }, 'intersect')).toEqual([link]);
    expect(hits.within(screen, { x: 492, y: 106, w: 4, h: 4 }, 'intersect')).toEqual([]);
    // a marquee box containing the whole connector, label and arrow included
    expect(hits.within(screen, { x: 50, y: -20, w: 520, h: 140 }, 'contain')).toEqual([link]);
    expect(hits.within(screen, { x: 50, y: -20, w: 520, h: 124 }, 'contain')).toEqual([]);
  });
});

describe('connector hit-testing, edges (FR-EDT-004)', () => {
  it('FR-EDT-004: a start marker is drawn from the start into the route; marquees touch its box on each side', () => {
    const { screen, link, at, hits } = setup({ markers: { start: 'arrow' } });
    expect([at(105, 108), at(105, 110), at(113, 108), at(115, 108)]).toEqual([link, undefined, link, undefined]);
    const pick = (x: number, y: number, w: number, h: number) => hits.within(screen, { x, y, w, h }, 'intersect');
    // its box spans x 100-110, y 95-105
    expect([pick(102, 91, 4, 4), pick(102, 89, 4, 4)]).toEqual([[link], []]);
    expect([pick(102, 105, 4, 4), pick(102, 106, 4, 4)]).toEqual([[link], []]);
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

  it('FR-TXT-002: a label with a size mark, a heading or spacing is hit on the box it is drawn in, not on a plain estimate', () => {
    const run = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks === undefined ? {} : { marks }) });
    const big = { type: 'doc', content: [{ type: 'paragraph', content: [run('Hi'), run('BIG', [{ type: 'size', attrs: { size: 54 } }])] }] };
    const plain = { type: 'doc', content: [{ type: 'paragraph', content: [run('Hi'), run('BIG')] }] };
    // the 54 px run makes the line 54 × 1.3 = 70.2 tall (plus 2) and 5 characters wide: 2 × 10.8 + 3 × 32.4 + 8
    const { at: withMark, link } = setup({ markers: {}, labels: [{ text: big, position: 0.5, offset: { x: 0, y: -200 } }] });
    const { at: without } = setup({ markers: {}, labels: [{ text: plain, position: 0.5, offset: { x: 0, y: -200 } }] });
    // 30 px above the label's centre: inside the tall box (72.2, half 36.1 and the pick margin), outside the plain one (25.4)
    expect([withMark(300, -200 + 100 - 30), withMark(300, -200 + 100 - 48)]).toEqual([link, undefined]);
    expect([without(300, -200 + 100 - 30), without(300, -200 + 100 - 20)]).toEqual([undefined, undefined]);
    // a heading's lines are as tall as its scale: 2 × the size, two lines of it
    const heading = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [run('Title that is long enough to wrap onto lines of its own here')] }],
    };
    const { at: head } = setup({ markers: {}, labels: [{ text: heading, position: 0.5, offset: { x: 0, y: -300 } }] });
    // 59 characters at 36 px (2 × 18): it wraps in LABEL_MAX_W less the padding, so the box is several lines tall: 60 px below its centre is still on it
    expect([head(300, -300 + 100 + 60), head(300 + 100, -300 + 100)]).toEqual([expect.anything(), expect.anything()]);
    // spacing around blocks counts: a 40 px gap after the first paragraph makes the label taller
    const spaced = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { spaceAfter: 40 }, content: [run('a')] },
        { type: 'paragraph', content: [run('b')] },
      ],
    };
    const tight = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [run('a')] },
        { type: 'paragraph', content: [run('b')] },
      ],
    };
    const { at: gap, link: gapLink } = setup({ markers: {}, labels: [{ text: spaced, position: 0.5, offset: { x: 0, y: -400 } }] });
    const { at: nogap } = setup({ markers: {}, labels: [{ text: tight, position: 0.5, offset: { x: 0, y: -400 } }] });
    // two lines of 23.4 plus 40 and the 2 px of padding: 88.8 tall; two lines alone are 48.8
    expect([gap(300, -400 + 100 + 40), nogap(300, -400 + 100 + 40)]).toEqual([gapLink, undefined]);
    // the space between blocks collapses as in a block layout: 40 after and 30 before is 40, not 70
    const both = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { spaceAfter: 40 }, content: [run('a')] },
        { type: 'paragraph', attrs: { spaceBefore: 30 }, content: [run('b')] },
      ],
    };
    const { at: collapsed, link: collapsedLink } = setup({ markers: {}, labels: [{ text: both, position: 0.5, offset: { x: 0, y: -400 } }] });
    expect([collapsed(300, -400 + 100 + 40), collapsed(300, -400 + 100 + 52)]).toEqual([collapsedLink, undefined]);
    // the width left for the text is the label's maximum less its padding: 22 characters (237.6 px) wrap, 21 (226.8) do not
    const wide = (words: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [run(words)] }] });
    const { at: wraps, link: wrapsLink } = setup({ markers: {}, labels: [{ text: wide('aaaaaaaaaaa bbbbbbbbbb'), position: 0.5, offset: { x: 0, y: -500 } }] });
    const { at: fits } = setup({ markers: {}, labels: [{ text: wide('aaaaaaaaaaa bbbbbbbbb'), position: 0.5, offset: { x: 0, y: -500 } }] });
    expect([wraps(300, -500 + 100 + 20), fits(300, -500 + 100 + 20)]).toEqual([wrapsLink, undefined]);
    // a label of nothing but a line break draws nothing to hit
    const empty = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'hardBreak' }] }] };
    const { at: nothing } = setup({ markers: {}, labels: [{ text: empty, position: 0.5, offset: { x: 0, y: -600 } }] });
    expect(nothing(300, -600 + 100)).toBeUndefined();
  });

  it('FR-EDT-004: an end marker sits at the route`s last point, after its bends, along its last segment', () => {
    const b = documentBuilder({ seed: 182 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const link = b.connect({ x: 100, y: 100 }, { x: 500, y: 300 }, { route: 'orthogonal' });
    const core = createCore(b.build());
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    const markers = createRegistry<string, MarkerDef>('markers');
    markers.register(ARROW.id, ARROW, 'test');
    const context = { ...registries(), routers, markers };
    const hits = createHitIndex(core.store, { registries: context, theme: LIGHT_THEME });
    const points = (routeConnector(core.store, context, link)?.commands ?? []).flatMap((c) => ('to' in c ? [c.to] : []));
    expect(points.length).toBeGreaterThan(2);
    const [prev, last, elbow] = [points.at(-2), points.at(-1), points[1]] as [Vec2, Vec2, Vec2];
    const l = Math.hypot(last.x - prev.x, last.y - prev.y);
    const u = { x: (last.x - prev.x) / l, y: (last.y - prev.y) / l };
    // 5 px behind the tip, 8 px beside the last segment: on the arrow, not on the stroke
    const beside = (p: Vec2, d: number) => ({ x: p.x - 5 * u.x - d * u.y, y: p.y - 5 * u.y + d * u.x });
    expect([hits.hitTest(screen, beside(last, 8), 1), hits.hitTest(screen, beside(last, 10), 1)]).toEqual([link, undefined]);
    // nothing is drawn at the first bend
    expect(hits.hitTest(screen, { x: elbow.x + 7, y: elbow.y + 7 }, 1)).toBeUndefined();
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

  it('FR-EDT-004: markers on a slanted route turn with it: boxes along the route, in bounds and marquees', () => {
    // (100, 100) to (500, 400): along u = (0.8, 0.6), across n = (-0.6, 0.8); markers 10 px, 5 px each side
    const b = documentBuilder({ seed: 184 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const link = b.connect({ x: 100, y: 100 }, { x: 500, y: 400 });
    const bare = b.connect({ x: 100, y: 600 }, { x: 500, y: 900 });
    const dot = b.connect({ x: 800, y: 100 }, { x: 800, y: 100 });
    const core = createCore(b.build());
    const patched = core.store.transact('markers', (tx) => {
      tx.patch(link, { markers: { start: 'arrow', end: 'arrow', mid: 'arrow' } });
      tx.patch(bare, { markers: { start: 'arrow' } });
      tx.patch(dot, { markers: { end: 'arrow' } });
    });
    expect(patched.ok).toBe(true);
    const markers = createRegistry<string, MarkerDef>('markers');
    markers.register(ARROW.id, ARROW, 'test');
    const hits = createHitIndex(core.store, { registries: { ...registries(), markers }, theme: LIGHT_THEME });
    const at = (x: number, y: number) => hits.hitTest(screen, { x, y }, 1);
    // the end's box runs from (492, 394) to the tip: 8 px beside it on either side, 3 px behind it, 13 in front
    expect([at(491.2, 403.4), at(490, 405), at(500.8, 390.6), at(484.8, 398.6), at(482.4, 396.8)]).toEqual([link, undefined, link, link, undefined]);
    expect([at(498.8, 406.6), at(500.4, 407.8)]).toEqual([link, undefined]);
    // the start's from the tip into the route; the middle one's about (300, 250)
    expect([at(99.2, 109.4), at(98, 111)]).toEqual([link, undefined]);
    expect([at(295.2, 256.4), at(288.8, 251.6), at(287.6, 250.7), at(286.4, 249.8)]).toEqual([link, link, undefined, undefined]);
    // a connector without an end marker has no box at its end
    expect(at(491.2, 903.4)).toBeUndefined();
    // a route of no length: its marker lies along x, back from its point
    expect([at(795, 103), at(805, 103)]).toEqual([dot, undefined]);
    // marquees: a corner of the end's box, a spot inside its body away from the route, and just clear
    const pick = (x: number, y: number, w: number, h: number) => hits.within(screen, { x, y, w, h }, 'intersect');
    expect([pick(494.5, 389.5, 1, 1), pick(494.1, 399.3, 0.2, 0.2), pick(494.5, 387, 1, 1)]).toEqual([[link], [link], []]);
    // the drawn bounds are the markers' corners: x 97-503, y 96-404
    const contained = (x: number, y: number, x2: number, y2: number) => hits.within(screen, { x, y, w: x2 - x, h: y2 - y }, 'contain').includes(link);
    expect([contained(96.5, 95.5, 503.5, 404.5), contained(97.5, 95.5, 503.5, 404.5), contained(96.5, 96.5, 503.5, 404.5)]).toEqual([true, false, false]);
    expect([contained(96.5, 95.5, 502.5, 404.5), contained(96.5, 95.5, 503.5, 403.5)]).toEqual([false, false]);
  });
});
