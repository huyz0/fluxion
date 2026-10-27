// The infographic pieces (FR-LIB-007): charts-as-shapes, layers, badges and banners drawn for Fluxion as declarative templates
// (ADR-0016), to build SmartArt-like figures from ordinary elements. `value` is a fraction from 0 to 1.
import type { ShapeDef } from '@fluxion/sdk';

const piece = (id: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'> & { category?: string }): ShapeDef => ({
  id: `infographic:${id}`,
  ...def,
  category: def.category ?? 'charts',
  license: 'MIT',
});

const value = { value: { type: 'number', min: 0.01, max: 0.99, default: 0.65 } } as const;
/** The point at `value` of a full turn clockwise from twelve o'clock on the ellipse of radii (`rx`, `ry`) about the centre. */
const at = (rx: string, ry: string) => [`w/2 + ${rx} * sin(2 * pi * value)`, `h/2 - ${ry} * cos(2 * pi * value)`];
/** SVG's large-arc flag: 1 when the slice passes half a turn. */
const large = 'round(value)';
/** A step pill's end radius: half the height, but never past the middle. */
const pillEnd = 'min(w/2, h/2)';
const circle = (rx: string, ry: string) => `M {w/2 - ${rx}} {h/2} A {${rx}} {${ry}} 0 1 1 {w/2 + ${rx}} {h/2} A {${rx}} {${ry}} 0 1 1 {w/2 - ${rx}} {h/2} Z`;
const r = 'min(w, h) * 0.1';

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  piece('pie', {
    params: value,
    outline: { path: `M {w/2} {h/2} V 0 A {w/2} {h/2} 0 {${large}} 1 {${at('w/2', 'h/2')[0]}} {${at('w/2', 'h/2')[1]}} Z` },
    handles: [{ param: 'value', x: at('w/2', 'h/2')[0] as string, y: at('w/2', 'h/2')[1] as string }],
    defaultSize: { w: 120, h: 120 },
    describe: 'A pie slice sized by a value: one share of a whole.',
    keywords: ['pie', 'slice', 'share', 'percentage', 'chart'],
  }),
  piece('donut', {
    params: { ...value, inner: { type: 'number', min: 0.2, max: 0.9, default: 0.6 } },
    outline: {
      path:
        `M {w/2} 0 A {w/2} {h/2} 0 {${large}} 1 {${at('w/2', 'h/2')[0]}} {${at('w/2', 'h/2')[1]}} ` +
        `L {${at('inner * w/2', 'inner * h/2')[0]}} {${at('inner * w/2', 'inner * h/2')[1]}} A {inner * w/2} {inner * h/2} 0 {${large}} 0 {w/2} {h/2 - inner * h/2} Z`,
    },
    defaultSize: { w: 120, h: 120 },
    describe: 'A donut ring segment sized by a value: progress toward a goal.',
    keywords: ['donut', 'ring', 'progress', 'percentage', 'chart'],
  }),
  piece('gauge', {
    params: value,
    outline: { path: 'M 0 {h} A {w/2} {h} 0 0 1 {w} {h} Z' },
    decorations: [{ path: 'M {w/2} {h} L {w/2 - w * 0.4 * cos(pi * value)} {h - h * 0.8 * sin(pi * value)}' }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A half-dial gauge whose needle shows a value: a level or a score.',
    keywords: ['gauge', 'dial', 'meter', 'speedometer', 'score'],
  }),
  piece('progress', {
    params: value,
    outline: { path: 'M {h/2} 0 H {w - h/2} A {h/2} {h/2} 0 0 1 {w - h/2} {h} H {h/2} A {h/2} {h/2} 0 0 1 {h/2} 0 Z' },
    decorations: [{ path: 'M {h * 0.25} {h * 0.25} H {h * 0.25 + (w - h/2) * value} V {h * 0.75} H {h * 0.25} Z' }],
    handles: [{ param: 'value', x: 'h * 0.25 + (w - h/2) * value', y: 'h/2' }],
    defaultSize: { w: 200, h: 24 },
    describe: 'A progress bar filled to a value: completion or capacity.',
    keywords: ['progress', 'bar', 'completion', 'capacity', 'percentage'],
  }),
  piece('target', {
    outline: { path: circle('w/2', 'h/2') },
    decorations: [{ path: circle('w * 0.33', 'h * 0.33') }, { path: circle('w * 0.16', 'h * 0.16') }],
    defaultSize: { w: 120, h: 120 },
    describe: 'A target of three rings: a goal, focus or objective.',
    keywords: ['target', 'goal', 'bullseye', 'focus', 'objective'],
  }),
  piece('venn', {
    category: 'diagrams',
    // two ellipses centred at 0.35w and 0.65w, radii 0.35w and h/2, meeting on x = w/2 at 0.0483h and 0.9517h
    outline: { path: 'M {w/2} {h * 0.0483} A {w * 0.35} {h/2} 0 1 0 {w/2} {h * 0.9517} A {w * 0.35} {h/2} 0 1 0 {w/2} {h * 0.0483} Z' },
    decorations: [
      { path: 'M {w/2} {h * 0.0483} A {w * 0.35} {h/2} 0 0 1 {w/2} {h * 0.9517}' },
      { path: 'M {w/2} {h * 0.0483} A {w * 0.35} {h/2} 0 0 0 {w/2} {h * 0.9517}' },
    ],
    defaultSize: { w: 200, h: 130 },
    describe: 'Two overlapping circles: what two sets share and where they differ.',
    keywords: ['venn', 'overlap', 'intersection', 'sets', 'compare'],
  }),
  piece('matrix', {
    category: 'diagrams',
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    decorations: [{ path: 'M {w/2} 0 V {h}' }, { path: 'M 0 {h/2} H {w}' }],
    defaultSize: { w: 160, h: 160 },
    describe: 'A two-by-two matrix: four quadrants on two axes.',
    keywords: ['matrix', 'quadrant', 'grid', 'two by two', 'swot'],
  }),
  piece('funnel', {
    category: 'layers',
    outline: { path: 'M 0 0 H {w} L {w * 0.6} {h * 0.75} V {h} H {w * 0.4} V {h * 0.75} Z' },
    decorations: [{ path: 'M {w * 0.133} {h * 0.25} H {w * 0.867}' }, { path: 'M {w * 0.267} {h * 0.5} H {w * 0.733}' }],
    defaultSize: { w: 160, h: 160 },
    describe: 'A funnel of narrowing stages: conversion or filtering.',
    keywords: ['funnel', 'conversion', 'stages', 'filter', 'sales'],
  }),
  piece('funnel-layer', {
    category: 'layers',
    params: { taper: { type: 'number', min: 0, max: 0.45, default: 0.1 } },
    outline: { path: 'M 0 0 H {w} L {w - w * taper} {h} H {w * taper} Z' },
    handles: [{ param: 'taper', x: 'w * taper', y: 'h' }],
    defaultSize: { w: 200, h: 50 },
    describe: 'One stage of a funnel: stack several, each narrower than the last.',
    keywords: ['funnel', 'layer', 'stage', 'trapezoid'],
  }),
  piece('pyramid', {
    category: 'layers',
    outline: { path: 'M {w/2} 0 L {w} {h} H 0 Z' },
    decorations: [{ path: 'M {w/3} {h/3} H {w * 2/3}' }, { path: 'M {w/6} {h * 2/3} H {w * 5/6}' }],
    defaultSize: { w: 180, h: 150 },
    describe: 'A pyramid of three tiers: a hierarchy or levels of importance.',
    keywords: ['pyramid', 'hierarchy', 'tiers', 'levels', 'triangle'],
  }),
  piece('step-pill', {
    category: 'labels',
    // the ends' horizontal radius never passes the middle, so a narrow pill stays inside its box, number circle included
    outline: {
      path: `M {${pillEnd}} 0 H {w - ${pillEnd}} A {${pillEnd}} {h/2} 0 0 1 {w - ${pillEnd}} {h} H {${pillEnd}} A {${pillEnd}} {h/2} 0 0 1 {${pillEnd}} 0 Z`,
    },
    decorations: [{ path: circle(`${pillEnd} * 0.76`, 'h * 0.38').replaceAll('w/2', `(${pillEnd})`) }],
    textRegions: [{ name: 'body', x: `2 * ${pillEnd} / w`, y: 0.1, w: `max(0, 1 - 2.4 * ${pillEnd} / w)`, h: 0.8 }],
    defaultSize: { w: 200, h: 50 },
    describe: 'A pill with a numbered circle: one step of a numbered list.',
    keywords: ['step', 'pill', 'numbered', 'list', 'stage'],
  }),
  piece('number-badge', {
    category: 'labels',
    outline: { path: circle('w/2', 'h/2') },
    decorations: [{ path: circle('w * 0.42', 'h * 0.42') }],
    textRegions: [{ name: 'body', x: 0.15, y: 0.15, w: 0.7, h: 0.7 }],
    defaultSize: { w: 60, h: 60 },
    describe: 'A round badge with a double rim: a number, rank or count.',
    keywords: ['badge', 'number', 'rank', 'count', 'circle'],
  }),
  piece('hexagon-tile', {
    category: 'labels',
    outline: { path: 'M {w/2} 0 L {w} {h/4} V {h * 3/4} L {w/2} {h} L 0 {h * 3/4} V {h/4} Z' },
    textRegions: [{ name: 'body', x: 0.1, y: 0.25, w: 0.8, h: 0.5 }],
    defaultSize: { w: 104, h: 120 },
    describe: 'A pointy-top hexagon tile that tessellates: a feature or capability.',
    keywords: ['hexagon', 'tile', 'honeycomb', 'feature', 'capability'],
  }),
  piece('stat-card', {
    category: 'labels',
    outline: {
      path: `M {${r}} 0 H {w - ${r}} A {${r}} {${r}} 0 0 1 {w} {${r}} V {h - ${r}} A {${r}} {${r}} 0 0 1 {w - ${r}} {h} H {${r}} A {${r}} {${r}} 0 0 1 0 {h - ${r}} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`,
    },
    decorations: [{ path: 'M {w * 0.1} {h * 0.62} H {w * 0.9}' }],
    textRegions: [
      { name: 'value', x: 0.1, y: 0.1, w: 0.8, h: 0.48 },
      { name: 'label', x: 0.1, y: 0.68, w: 0.8, h: 0.24 },
    ],
    defaultSize: { w: 160, h: 110 },
    describe: 'A card for one headline number above its label: a KPI.',
    keywords: ['stat', 'kpi', 'metric', 'number', 'card'],
  }),
  piece('banner', {
    category: 'labels',
    outline: {
      path: 'M 0 {h * 0.2} H {w * 0.12} V 0 H {w * 0.88} V {h * 0.2} H {w} L {w * 0.94} {h * 0.55} L {w} {h * 0.9} H {w * 0.88} V {h * 0.7} H {w * 0.12} V {h * 0.9} H 0 L {w * 0.06} {h * 0.55} Z',
    },
    decorations: [{ path: 'M {w * 0.12} {h * 0.7} V {h * 0.2}' }, { path: 'M {w * 0.88} {h * 0.7} V {h * 0.2}' }],
    textRegions: [{ name: 'body', x: 0.15, y: 0.05, w: 0.7, h: 0.6 }],
    defaultSize: { w: 240, h: 70 },
    describe: 'A ribbon banner with folded ends: a title or announcement.',
    keywords: ['banner', 'ribbon', 'title', 'heading', 'announcement'],
  }),
  piece('milestone', {
    category: 'labels',
    outline: { path: 'M {w/2} 0 L {w} {h * 0.35} L {w/2} {h * 0.7} L 0 {h * 0.35} Z' },
    decorations: [{ path: 'M {w/2} {h * 0.7} V {h}' }],
    defaultSize: { w: 40, h: 60 },
    describe: 'A diamond milestone on a stem: a date or event on a timeline.',
    keywords: ['milestone', 'timeline', 'event', 'date', 'marker'],
  }),
];
