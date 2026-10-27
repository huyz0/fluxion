// UML-lite (FR-LIB-007): the class, component, use-case, sequence and state notation people draw most, as declarative
// templates drawn for Fluxion (ADR-0016). Compartment lines and inner marks are decorations; text regions name each part.
import type { ShapeDef } from '@fluxion/sdk';

const uml = (id: string, category: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'>): ShapeDef => ({
  id: `uml:${id}`,
  ...def,
  category,
  license: 'MIT',
});

const box = 'M 0 0 H {w} V {h} H 0 Z';
const circle = (rx: string, ry: string) => `M {w/2 - ${rx}} {h/2} A {${rx}} {${ry}} 0 1 1 {w/2 + ${rx}} {h/2} A {${rx}} {${ry}} 0 1 1 {w/2 - ${rx}} {h/2} Z`;
const r = 'min(w, h) * 0.2';
/** The name compartment's height: at most 30 units, never more than a third of the box. */
const head = 'min(30, h / 3)';
/** The artifact icon's scale: full size from a 60 x 40 box up, smaller below. */
const icon = 'min(1, w / 60, h / 40)';
/** A combined fragment's operator tag: its size and the cut of its corner, all shrinking with the box. */
const tagW = 'min(70, w * 0.4)';
const tagH = 'min(24, h * 0.3)';
const tagCut = 'min(10, w * 0.2, h * 0.15)';
/** A note's folded corner: 16 units, at most a third of the shorter side. */
const fold = 'min(16, w / 3, h / 3)';

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  uml('class', 'structure', {
    outline: { path: box },
    decorations: [{ path: `M 0 {${head}} H {w}` }, { path: `M 0 {${head} + (h - ${head}) / 2} H {w}` }],
    textRegions: [
      { name: 'name', x: 0, y: 0, w: 1, h: `${head} / h` },
      { name: 'attributes', x: 0.04, y: `${head} / h`, w: 0.92, h: `(1 - ${head} / h) / 2` },
      { name: 'operations', x: 0.04, y: `(1 + ${head} / h) / 2`, w: 0.92, h: `(1 - ${head} / h) / 2` },
    ],
    defaultSize: { w: 180, h: 140 },
    describe: 'A class with name, attributes and operations compartments.',
    keywords: ['class', 'uml', 'type', 'attributes', 'operations'],
  }),
  uml('interface', 'structure', {
    outline: { path: box },
    decorations: [{ path: `M 0 {${head} * 1.5} H {w}` }],
    textRegions: [
      { name: 'name', x: 0, y: 0, w: 1, h: `1.5 * ${head} / h` },
      { name: 'operations', x: 0.04, y: `1.5 * ${head} / h`, w: 0.92, h: `1 - 1.5 * ${head} / h` },
    ],
    defaultSize: { w: 180, h: 110 },
    describe: 'An interface: a named set of operations, with room for the «interface» keyword.',
    keywords: ['interface', 'uml', 'contract', 'operations', 'protocol'],
  }),
  uml('object', 'structure', {
    outline: { path: box },
    decorations: [{ path: `M 0 {${head}} H {w}` }],
    textRegions: [
      { name: 'name', x: 0, y: 0, w: 1, h: `${head} / h` },
      { name: 'slots', x: 0.04, y: `${head} / h`, w: 0.92, h: `1 - ${head} / h` },
    ],
    defaultSize: { w: 160, h: 90 },
    describe: 'An object (instance) with its slot values.',
    keywords: ['object', 'instance', 'uml', 'slots'],
  }),
  uml('package', 'structure', {
    outline: { path: 'M 0 0 H {w * 0.4} V {h * 0.15} H {w} V {h} H 0 Z' },
    decorations: [{ path: 'M 0 {h * 0.15} H {w * 0.4}' }],
    textRegions: [{ name: 'body', x: 0.04, y: 0.2, w: 0.92, h: 0.75 }],
    defaultSize: { w: 200, h: 140 },
    describe: 'A package (tabbed folder) grouping related elements.',
    keywords: ['package', 'namespace', 'module', 'folder', 'uml'],
  }),
  uml('component', 'structure', {
    outline: { path: 'M {w * 0.1} 0 H {w} V {h} H {w * 0.1} V {h * 0.65} H 0 V {h * 0.5} H {w * 0.1} V {h * 0.35} H 0 V {h * 0.2} H {w * 0.1} Z' },
    decorations: [{ path: 'M 0 {h * 0.2} H {w * 0.2} V {h * 0.35} H 0' }, { path: 'M 0 {h * 0.5} H {w * 0.2} V {h * 0.65} H 0' }],
    textRegions: [{ name: 'body', x: 0.24, y: 0.1, w: 0.72, h: 0.8 }],
    defaultSize: { w: 180, h: 100 },
    describe: 'A component: a replaceable unit with interfaces, such as a service or library.',
    keywords: ['component', 'module', 'service', 'library', 'uml'],
  }),
  uml('node', 'structure', {
    outline: { path: 'M 0 {h * 0.15} L {w * 0.15} 0 H {w} V {h * 0.85} L {w * 0.85} {h} H 0 Z' },
    decorations: [{ path: 'M 0 {h * 0.15} H {w * 0.85} L {w} 0' }, { path: 'M {w * 0.85} {h * 0.15} V {h}' }],
    textRegions: [{ name: 'body', x: 0.04, y: 0.2, w: 0.77, h: 0.75 }],
    defaultSize: { w: 180, h: 120 },
    describe: 'A deployment node (a 3-D box): a device or execution environment.',
    keywords: ['node', 'deployment', 'device', 'server', 'environment'],
  }),
  uml('artifact', 'structure', {
    outline: { path: box },
    // a small dog-eared document in the top-right corner, scaled down with the box
    decorations: [
      { path: `M {w - 22 * ${icon}} {6 * ${icon}} H {w - 12 * ${icon}} L {w - 8 * ${icon}} {10 * ${icon}} V {24 * ${icon}} H {w - 22 * ${icon}} Z` },
      { path: `M {w - 12 * ${icon}} {6 * ${icon}} V {10 * ${icon}} H {w - 8 * ${icon}}` },
    ],
    textRegions: [{ name: 'body', x: 0.05, y: 0.1, w: 0.6, h: 0.8 }],
    defaultSize: { w: 140, h: 90 },
    describe: 'An artifact: a deployable file such as a binary, script or document.',
    keywords: ['artifact', 'file', 'binary', 'jar', 'deployable'],
  }),
  uml('note', 'structure', {
    outline: { path: `M 0 0 H {w - ${fold}} L {w} {${fold}} V {h} H 0 Z` },
    decorations: [{ path: `M {w - ${fold}} 0 V {${fold}} H {w}` }],
    textRegions: [{ name: 'body', x: 0.05, y: 0.1, w: 0.85, h: 0.85 }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A UML note with a folded corner: a comment attached to an element.',
    keywords: ['note', 'comment', 'annotation', 'uml'],
  }),
  uml('provided-interface', 'structure', {
    outline: { path: 'M 0 {h/2} A {min(w, h)/2} {min(w, h)/2} 0 1 1 {min(w, h)} {h/2} A {min(w, h)/2} {min(w, h)/2} 0 1 1 0 {h/2} Z' },
    decorations: [{ path: 'M {min(w, h)} {h/2} H {w}' }],
    defaultStyle: { font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
    defaultSize: { w: 80, h: 24 },
    describe: 'A provided interface (lollipop): a ball on a stem a component offers.',
    keywords: ['interface', 'lollipop', 'provided', 'port', 'ball'],
  }),
  uml('actor', 'use-case', {
    // a person figure as one closed outline (head, shoulders, arms, legs), so every floating connector end lands on its edge:
    // a stick figure drawn with strokes encloses nothing for a connector to meet; the name sits in the band below it
    outline: {
      path: [
        'M {w * 0.44} {h * 0.2} A {w * 0.14} {h * 0.1} 0 1 1 {w * 0.56} {h * 0.2}',
        'L {w * 0.9} {h * 0.26} L {w * 0.9} {h * 0.5} L {w * 0.76} {h * 0.5} L {w * 0.74} {h * 0.36}',
        'L {w * 0.8} {h * 0.78} L {w * 0.56} {h * 0.78} L {w/2} {h * 0.62} L {w * 0.44} {h * 0.78} L {w * 0.2} {h * 0.78}',
        'L {w * 0.26} {h * 0.36} L {w * 0.24} {h * 0.5} L {w * 0.1} {h * 0.5} L {w * 0.1} {h * 0.26} Z',
      ].join(' '),
    },
    anchors: [
      { name: 'n', x: 0.5, y: 0, dir: { x: 0, y: -1 } },
      { name: 'e', x: 0.9, y: 0.38, dir: { x: 1, y: 0 } },
      { name: 's', x: 0.5, y: 0.62, dir: { x: 0, y: 1 } },
      { name: 'w', x: 0.1, y: 0.38, dir: { x: -1, y: 0 } },
    ],
    textRegions: [{ name: 'body', x: 0, y: 0.8, w: 1, h: 0.2 }],
    defaultSize: { w: 70, h: 130 },
    describe: 'An actor (person figure): a person or system that uses the system.',
    keywords: ['actor', 'user', 'person', 'role', 'stick figure', 'human'],
  }),
  uml('use-case', 'use-case', {
    outline: { path: circle('w/2', 'h/2') },
    textRegions: [{ name: 'body', x: 0.15, y: 0.15, w: 0.7, h: 0.7 }],
    defaultSize: { w: 180, h: 80 },
    describe: 'A use case (ellipse): something an actor achieves with the system.',
    keywords: ['use case', 'goal', 'scenario', 'ellipse', 'uml'],
  }),
  uml('system-boundary', 'use-case', {
    outline: { path: box },
    defaultStyle: { fill: 'transparent' },
    textRegions: [{ name: 'body', x: 0.02, y: 0.02, w: 0.96, h: 0.1 }],
    defaultSize: { w: 320, h: 260 },
    describe: 'A system boundary: the box that encloses a system’s use cases.',
    keywords: ['system', 'boundary', 'subject', 'scope', 'container'],
  }),
  uml('lifeline', 'sequence', {
    outline: { path: 'M 0 0 H {w} V {min(50, h * 0.2)} H 0 Z' },
    decorations: [{ path: 'M {w/2} {min(50, h * 0.2)} V {h}' }],
    textRegions: [{ name: 'body', x: 0, y: 0, w: 1, h: 'min(50, h * 0.2) / h' }],
    defaultSize: { w: 120, h: 300 },
    describe: 'A sequence-diagram lifeline: a participant with its line of time below it.',
    keywords: ['lifeline', 'sequence', 'participant', 'timeline'],
  }),
  uml('activation', 'sequence', {
    outline: { path: box },
    defaultSize: { w: 16, h: 120 },
    describe: 'An activation bar on a lifeline: while a participant is busy.',
    keywords: ['activation', 'execution', 'focus', 'sequence'],
  }),
  uml('fragment', 'sequence', {
    outline: { path: box },
    defaultStyle: { fill: 'transparent' },
    decorations: [{ path: `M 0 {${tagH}} H {${tagW} - ${tagCut}} L {${tagW}} {${tagH} - ${tagCut}} V 0` }],
    textRegions: [{ name: 'operator', x: 0.01, y: 0, w: `max(0, ${tagW} / w - 0.06)`, h: `${tagH} / h` }],
    defaultSize: { w: 300, h: 160 },
    describe: 'A combined fragment (alt, loop, opt): a framed part of an interaction.',
    keywords: ['fragment', 'alt', 'loop', 'opt', 'frame', 'sequence'],
  }),
  uml('state', 'state', {
    outline: {
      path: `M {${r}} 0 H {w - ${r}} A {${r}} {${r}} 0 0 1 {w} {${r}} V {h - ${r}} A {${r}} {${r}} 0 0 1 {w - ${r}} {h} H {${r}} A {${r}} {${r}} 0 0 1 0 {h - ${r}} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`,
    },
    defaultSize: { w: 150, h: 70 },
    describe: 'A state: a condition an object stays in until an event moves it on.',
    keywords: ['state', 'status', 'machine', 'condition'],
  }),
  uml('initial', 'state', {
    outline: { path: circle('w/2', 'h/2') },
    defaultStyle: { fill: '{color.text}', font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
    defaultSize: { w: 30, h: 30 },
    describe: 'The initial pseudo-state (a filled dot): where a state machine starts.',
    keywords: ['initial', 'start', 'begin', 'dot', 'state'],
  }),
  uml('final', 'state', {
    // the bull's-eye as one filled subpath: the ring clockwise, the gap inside it counter-clockwise, the dot clockwise again,
    // joined by a seam that fills nothing; so the outline (and connectors) sit on the ring and the gap stays clear
    outline: {
      path: [
        'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2}',
        'L {w * 0.1} {h/2} A {w * 0.4} {h * 0.4} 0 1 0 {w * 0.9} {h/2} A {w * 0.4} {h * 0.4} 0 1 0 {w * 0.1} {h/2}',
        'L {w * 0.22} {h/2} A {w * 0.28} {h * 0.28} 0 1 1 {w * 0.78} {h/2} A {w * 0.28} {h * 0.28} 0 1 1 {w * 0.22} {h/2} Z',
      ].join(' '),
    },
    defaultStyle: { fill: '{color.text}', stroke: { width: 0 }, font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
    defaultSize: { w: 30, h: 30 },
    describe: 'The final state (a ring around a filled dot): where a state machine ends.',
    keywords: ['final', 'end', 'stop', 'state'],
  }),
  uml('choice', 'state', {
    outline: { path: 'M {w/2} 0 L {w} {h/2} L {w/2} {h} L 0 {h/2} Z' },
    defaultSize: { w: 40, h: 40 },
    describe: 'A choice (small diamond): a branch on guard conditions.',
    keywords: ['choice', 'decision', 'branch', 'guard', 'merge'],
  }),
  uml('fork', 'state', {
    outline: { path: box },
    defaultStyle: { fill: '{color.text}', font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
    defaultSize: { w: 160, h: 8 },
    describe: 'A fork or join bar: flows split into, or wait for, parallel branches.',
    keywords: ['fork', 'join', 'parallel', 'bar', 'synchronise'],
  }),
];
