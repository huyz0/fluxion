// The callouts (FR-LIB-007): speech and thought bubbles, labels and annotation marks drawn for Fluxion as declarative
// templates (ADR-0016). Each tail stays inside the box, so selection and hit bounds cover the whole outline.
import type { ShapeDef } from '@fluxion/sdk';

const callout = (id: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'> & { category?: string }): ShapeDef => ({
  id: `callouts:${id}`,
  ...def,
  category: def.category ?? 'speech',
  license: 'MIT',
});

/** The bubble's bottom edge; the tail fills the box below it. */
const body = 'h * 0.75';
/** A tail whose base starts at `tail` of the width and whose tip sits at the bottom of the box. */
const tail = { tail: { type: 'number', min: 0.05, max: 0.75, default: 0.2 } } as const;
const r = 'min(w, h) * 0.12';
/** Where the tail's base, at the width fraction `f`, meets the lower half of the oval centred at (w/2, 0.375h) with radii w/2 and 0.375h. */
const ovalY = (f: string) => `h * 0.375 + h * 0.375 * sqrt(1 - (2 * (${f}) - 1) * (2 * (${f}) - 1))`;

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  callout('speech-rect', {
    params: tail,
    outline: { path: `M 0 0 H {w} V {${body}} H {w * (tail + 0.2)} L {w * (tail - 0.05)} {h} L {w * (tail + 0.08)} {${body}} H 0 Z` },
    handles: [{ param: 'tail', x: 'w * (tail - 0.05)', y: 'h' }],
    textRegions: [{ name: 'body', x: 0.05, y: 0.05, w: 0.9, h: 0.65 }],
    defaultSize: { w: 180, h: 110 },
    describe: 'A rectangular speech bubble: something a person or system says.',
    keywords: ['speech', 'bubble', 'say', 'dialogue', 'comment'],
  }),
  callout('speech-rounded', {
    params: tail,
    outline: {
      path: `M {${r}} 0 H {w - ${r}} A {${r}} {${r}} 0 0 1 {w} {${r}} V {${body} - ${r}} A {${r}} {${r}} 0 0 1 {w - ${r}} {${body}} H {w * (tail + 0.2)} L {w * (tail - 0.05)} {h} L {w * (tail + 0.08)} {${body}} H {${r}} A {${r}} {${r}} 0 0 1 0 {${body} - ${r}} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`,
    },
    handles: [{ param: 'tail', x: 'w * (tail - 0.05)', y: 'h' }],
    textRegions: [{ name: 'body', x: 0.06, y: 0.06, w: 0.88, h: 0.62 }],
    defaultSize: { w: 180, h: 110 },
    describe: 'A rounded speech bubble: a friendly remark or chat message.',
    keywords: ['speech', 'bubble', 'rounded', 'chat', 'message'],
  }),
  callout('speech-oval', {
    params: { tail: { type: 'number', min: 0.15, max: 0.7, default: 0.3 } },
    outline: {
      path: `M {w * (tail + 0.12)} {${ovalY('tail + 0.12')}} A {w/2} {h * 0.375} 0 1 0 {w * tail} {${ovalY('tail')}} L {w * (tail - 0.1)} {h} Z`,
    },
    handles: [{ param: 'tail', x: 'w * (tail - 0.1)', y: 'h' }],
    textRegions: [{ name: 'body', x: 0.18, y: 0.15, w: 0.64, h: 0.45 }],
    defaultSize: { w: 180, h: 120 },
    describe: 'An oval speech bubble: a spoken line in a comic-style dialogue.',
    keywords: ['speech', 'bubble', 'oval', 'comic', 'dialogue'],
  }),
  callout('speech-left', {
    params: { tail: { type: 'number', min: 0.1, max: 0.7, default: 0.4 } },
    outline: { path: 'M {w * 0.15} 0 H {w} V {h} H {w * 0.15} V {h * (tail + 0.25)} L 0 {h * (tail + 0.05)} L {w * 0.15} {h * tail} Z' },
    handles: [{ param: 'tail', x: '0', y: 'h * (tail + 0.05)' }],
    textRegions: [{ name: 'body', x: 0.2, y: 0.08, w: 0.75, h: 0.84 }],
    defaultSize: { w: 200, h: 90 },
    describe: 'A speech bubble whose tail points left: a reply beside a speaker.',
    keywords: ['speech', 'bubble', 'left', 'reply', 'chat'],
  }),
  callout('thought', {
    outline: {
      path: 'M {w * 0.2} {h * 0.2} A {w * 0.14} {h * 0.14} 0 0 1 {w * 0.45} {h * 0.08} A {w * 0.15} {h * 0.14} 0 0 1 {w * 0.75} {h * 0.1} A {w * 0.14} {h * 0.15} 0 0 1 {w * 0.9} {h * 0.4} A {w * 0.12} {h * 0.13} 0 0 1 {w * 0.75} {h * 0.66} A {w * 0.15} {h * 0.12} 0 0 1 {w * 0.45} {h * 0.7} A {w * 0.15} {h * 0.13} 0 0 1 {w * 0.15} {h * 0.6} A {w * 0.12} {h * 0.15} 0 0 1 {w * 0.2} {h * 0.2} Z',
    },
    decorations: [
      { path: 'M {w * 0.12} {h * 0.82} A {w * 0.05} {h * 0.05} 0 1 1 {w * 0.22} {h * 0.82} A {w * 0.05} {h * 0.05} 0 1 1 {w * 0.12} {h * 0.82} Z' },
      { path: 'M {w * 0.03} {h * 0.95} A {w * 0.03} {h * 0.03} 0 1 1 {w * 0.09} {h * 0.95} A {w * 0.03} {h * 0.03} 0 1 1 {w * 0.03} {h * 0.95} Z' },
    ],
    textRegions: [{ name: 'body', x: 0.22, y: 0.18, w: 0.56, h: 0.42 }],
    defaultSize: { w: 190, h: 130 },
    describe: 'A thought bubble: an idea, a wish or something unspoken.',
    keywords: ['thought', 'bubble', 'idea', 'think', 'cloud'],
  }),
  callout('shout', {
    outline: {
      polygon: {
        n: '24',
        x: 'w/2 + (i % 2 ? 0.36 : 0.5) * w * sin(2 * pi * i / n)',
        y: 'h/2 - (i % 2 ? 0.36 : 0.5) * h * cos(2 * pi * i / n)',
      },
    },
    textRegions: [{ name: 'body', x: 0.22, y: 0.25, w: 0.56, h: 0.5 }],
    defaultSize: { w: 180, h: 140 },
    describe: 'A jagged burst: a shout, an alert or something new.',
    keywords: ['shout', 'burst', 'explosion', 'alert', 'new', 'starburst'],
  }),
  callout('line', {
    category: 'annotation',
    outline: { path: 'M {w * 0.3} 0 H {w} V {h * 0.6} H {w * 0.3} Z' },
    decorations: [{ path: 'M {w * 0.3} {h * 0.6} L 0 {h}' }],
    textRegions: [{ name: 'body', x: 0.33, y: 0.05, w: 0.64, h: 0.5 }],
    defaultSize: { w: 200, h: 110 },
    describe: 'A box with a leader line to the point it labels.',
    keywords: ['line', 'callout', 'leader', 'label', 'annotation'],
  }),
  callout('sticky-note', {
    category: 'annotation',
    outline: { path: 'M 0 0 H {w} V {h * 0.8} L {w * 0.8} {h} H 0 Z' },
    decorations: [{ path: 'M {w} {h * 0.8} H {w * 0.8} V {h}' }],
    defaultStyle: { fill: '#fde68a' },
    textRegions: [{ name: 'body', x: 0.08, y: 0.08, w: 0.84, h: 0.68 }],
    defaultSize: { w: 140, h: 140 },
    describe: 'A sticky note with a turned-up corner: a reminder or review comment.',
    keywords: ['sticky', 'note', 'post-it', 'reminder', 'memo'],
  }),
  callout('tag', {
    category: 'label',
    outline: { path: 'M 0 {h/2} L {w * 0.2} 0 H {w} V {h} H {w * 0.2} Z' },
    decorations: [{ path: 'M {w * 0.12} {h/2} A {h * 0.08} {h * 0.08} 0 1 1 {w * 0.12 + h * 0.16} {h/2} A {h * 0.08} {h * 0.08} 0 1 1 {w * 0.12} {h/2} Z' }],
    textRegions: [{ name: 'body', x: 0.25, y: 0.1, w: 0.7, h: 0.8 }],
    defaultSize: { w: 150, h: 60 },
    describe: 'A luggage tag: a label, version or price.',
    keywords: ['tag', 'label', 'price', 'version'],
  }),
  callout('pin', {
    category: 'label',
    outline: { path: 'M {w/2} {h} L {w * 0.15} {h * 0.55} A {w * 0.4} {h * 0.35} 0 1 1 {w * 0.85} {h * 0.55} Z' },
    decorations: [
      { path: 'M {w * 0.35} {h * 0.35} A {w * 0.15} {h * 0.13} 0 1 1 {w * 0.65} {h * 0.35} A {w * 0.15} {h * 0.13} 0 1 1 {w * 0.35} {h * 0.35} Z' },
    ],
    textRegions: [{ name: 'body', x: 0.2, y: 0.15, w: 0.6, h: 0.4 }],
    defaultSize: { w: 70, h: 100 },
    describe: 'A map pin: a location, a marked point or "you are here".',
    keywords: ['pin', 'location', 'map', 'marker', 'place'],
  }),
  callout('quote', {
    category: 'label',
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    decorations: [
      { path: 'M {w * 0.06} {h * 0.3} Q {w * 0.06} {h * 0.12} {w * 0.12} {h * 0.1}' },
      { path: 'M {w * 0.12} {h * 0.3} Q {w * 0.12} {h * 0.12} {w * 0.18} {h * 0.1}' },
      { path: 'M {w * 0.94} {h * 0.7} Q {w * 0.94} {h * 0.88} {w * 0.88} {h * 0.9}' },
      { path: 'M {w * 0.88} {h * 0.7} Q {w * 0.88} {h * 0.88} {w * 0.82} {h * 0.9}' },
    ],
    textRegions: [{ name: 'body', x: 0.2, y: 0.12, w: 0.6, h: 0.76 }],
    defaultSize: { w: 220, h: 100 },
    describe: 'A quotation box: a testimonial or a cited statement.',
    keywords: ['quote', 'quotation', 'testimonial', 'citation'],
  }),
  callout('brace', {
    category: 'annotation',
    outline: {
      path: 'M {w} 0 Q {w * 0.5} 0 {w * 0.5} {h * 0.1} V {h * 0.4} Q {w * 0.5} {h/2} 0 {h/2} Q {w * 0.5} {h/2} {w * 0.5} {h * 0.6} V {h * 0.9} Q {w * 0.5} {h} {w} {h}',
    },
    defaultStyle: { fill: 'transparent' },
    defaultSize: { w: 30, h: 160 },
    describe: 'A curly brace grouping the items beside it under one note.',
    keywords: ['brace', 'curly', 'group', 'bracket', 'annotation'],
  }),
  callout('bracket', {
    category: 'annotation',
    outline: { path: 'M {w} 0 H 0 V {h} H {w}' },
    defaultStyle: { fill: 'transparent' },
    defaultSize: { w: 24, h: 160 },
    describe: 'A square bracket marking a span of items.',
    keywords: ['bracket', 'square', 'span', 'group', 'annotation'],
  }),
];
