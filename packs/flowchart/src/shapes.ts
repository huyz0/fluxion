// The flowchart symbols (FR-LIB-007): the ISO 5807 / common flowchart vocabulary as declarative outlines (ADR-0016), drawn for
// Fluxion. Outlines are one closed subpath; inner strokes (a predefined process's bars, a database's rim) are decorations.
import type { ShapeDef } from '@fluxion/sdk';

const MIT = 'MIT';
/** A rounded corner radius that never exceeds half the shorter side. */
const r = 'min(w, h) * 0.15';
/** A bar or band inset, as a fraction of the width. */
const bar = 'w * 0.1';

const step = (id: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'> & { category?: string }): ShapeDef => ({
  id: `flowchart:${id}`,
  ...def,
  category: def.category ?? 'process',
  license: MIT,
});

/**
 * The flowchart shapes, in library order.
 *
 * @public
 */
export const flowchartShapes: readonly ShapeDef[] = [
  step('process', {
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    defaultSize: { w: 160, h: 80 },
    describe: 'A process step: an action or operation.',
    keywords: ['process', 'step', 'action', 'task'],
  }),
  step('alternate-process', {
    outline: {
      path: `M {${r}} 0 H {w - ${r}} A {${r}} {${r}} 0 0 1 {w} {${r}} V {h - ${r}} A {${r}} {${r}} 0 0 1 {w - ${r}} {h} H {${r}} A {${r}} {${r}} 0 0 1 0 {h - ${r}} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`,
    },
    defaultSize: { w: 160, h: 80 },
    describe: 'An alternate process: a step that replaces the usual one.',
    keywords: ['alternate', 'process', 'step', 'rounded'],
  }),
  step('decision', {
    outline: { path: 'M {w/2} 0 L {w} {h/2} L {w/2} {h} L 0 {h/2} Z' },
    textRegions: [{ name: 'body', x: 0.2, y: 0.25, w: 0.6, h: 0.5 }],
    defaultSize: { w: 160, h: 100 },
    describe: 'A decision: a question with a yes/no or multi-way branch.',
    keywords: ['decision', 'branch', 'condition', 'if', 'diamond'],
  }),
  step('terminator', {
    outline: { path: 'M {h/2} 0 H {w - h/2} A {h/2} {h/2} 0 0 1 {w - h/2} {h} H {h/2} A {h/2} {h/2} 0 0 1 {h/2} 0 Z' },
    defaultSize: { w: 160, h: 60 },
    describe: 'A terminator: where a flow starts or ends.',
    keywords: ['terminator', 'start', 'end', 'stop', 'begin'],
  }),
  step('predefined-process', {
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    decorations: [{ path: `M {${bar}} 0 V {h}` }, { path: `M {w - ${bar}} 0 V {h}` }],
    textRegions: [{ name: 'body', x: 0.12, y: 0.1, w: 0.76, h: 0.8 }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A predefined process: a named subroutine defined elsewhere.',
    keywords: ['predefined', 'subroutine', 'function', 'call'],
  }),
  step('preparation', {
    outline: { path: `M {w * 0.15} 0 H {w * 0.85} L {w} {h/2} L {w * 0.85} {h} H {w * 0.15} L 0 {h/2} Z` },
    defaultSize: { w: 160, h: 80 },
    describe: 'Preparation: setup or initialisation before a process, such as a loop start.',
    keywords: ['preparation', 'setup', 'initialise', 'loop', 'hexagon'],
  }),
  step('manual-operation', {
    outline: { path: 'M 0 0 H {w} L {w * 0.8} {h} H {w * 0.2} Z' },
    defaultSize: { w: 160, h: 80 },
    describe: 'A manual operation: a step a person performs.',
    keywords: ['manual', 'operation', 'human', 'trapezoid'],
  }),
  step('delay', {
    outline: { path: 'M 0 0 H {w - h/2} A {h/2} {h/2} 0 0 1 {w - h/2} {h} H 0 Z' },
    defaultSize: { w: 140, h: 80 },
    describe: 'A delay: waiting before the flow continues.',
    keywords: ['delay', 'wait', 'pause'],
  }),
  step('data', {
    category: 'data',
    outline: { path: 'M {w * 0.2} 0 H {w} L {w * 0.8} {h} H 0 Z' },
    defaultSize: { w: 160, h: 80 },
    describe: 'Data: input to or output from a process.',
    keywords: ['data', 'input', 'output', 'io', 'parallelogram'],
  }),
  step('manual-input', {
    category: 'data',
    outline: { path: 'M 0 {h * 0.3} L {w} 0 V {h} H 0 Z' },
    textRegions: [{ name: 'body', x: 0.05, y: 0.35, w: 0.9, h: 0.6 }],
    defaultSize: { w: 160, h: 80 },
    describe: 'Manual input: data a person enters, such as on a keyboard.',
    keywords: ['manual', 'input', 'keyboard', 'entry'],
  }),
  step('document', {
    category: 'data',
    outline: { path: 'M 0 0 H {w} V {h * 0.85} C {w * 0.75} {h * 0.65} {w * 0.25} {h * 1.05} 0 {h * 0.85} Z' },
    textRegions: [{ name: 'body', x: 0.05, y: 0.05, w: 0.9, h: 0.7 }],
    defaultSize: { w: 160, h: 90 },
    describe: 'A document: a printed or generated report.',
    keywords: ['document', 'report', 'page', 'print'],
  }),
  step('multi-document', {
    category: 'data',
    outline: {
      path: 'M 0 {h * 0.16} H {w * 0.84} V {h * 0.87} C {w * 0.63} {h * 0.7} {w * 0.21} {h * 1.04} 0 {h * 0.87} Z',
    },
    decorations: [
      { path: 'M {w * 0.08} {h * 0.16} V {h * 0.08} H {w * 0.92} V {h * 0.79} H {w * 0.84}' },
      { path: 'M {w * 0.16} {h * 0.08} V 0 H {w} V {h * 0.71} H {w * 0.92}' },
    ],
    textRegions: [{ name: 'body', x: 0.04, y: 0.2, w: 0.76, h: 0.55 }],
    defaultSize: { w: 170, h: 100 },
    describe: 'Multiple documents: a set of reports or files.',
    keywords: ['documents', 'multiple', 'reports', 'files'],
  }),
  step('database', {
    category: 'data',
    outline: { path: 'M 0 {h * 0.12} V {h * 0.88} A {w/2} {h * 0.12} 0 0 0 {w} {h * 0.88} V {h * 0.12} A {w/2} {h * 0.12} 0 0 0 0 {h * 0.12} Z' },
    decorations: [{ path: 'M 0 {h * 0.12} A {w/2} {h * 0.12} 0 0 0 {w} {h * 0.12}' }],
    textRegions: [{ name: 'body', x: 0.05, y: 0.3, w: 0.9, h: 0.55 }],
    defaultSize: { w: 120, h: 120 },
    describe: 'A database: data stored for direct access.',
    keywords: ['database', 'db', 'storage', 'disk', 'cylinder'],
  }),
  step('stored-data', {
    category: 'data',
    outline: { path: 'M {w * 0.15} 0 H {w} A {w * 0.15} {h/2} 0 0 0 {w} {h} H {w * 0.15} A {w * 0.15} {h/2} 0 0 1 {w * 0.15} 0 Z' },
    defaultSize: { w: 160, h: 80 },
    describe: 'Stored data: data kept in any storage medium.',
    keywords: ['stored', 'data', 'storage', 'save'],
  }),
  step('internal-storage', {
    category: 'data',
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    decorations: [{ path: 'M {w * 0.15} 0 V {h}' }, { path: 'M 0 {h * 0.2} H {w}' }],
    textRegions: [{ name: 'body', x: 0.18, y: 0.25, w: 0.78, h: 0.7 }],
    defaultSize: { w: 140, h: 90 },
    describe: 'Internal storage: data held in memory.',
    keywords: ['internal', 'storage', 'memory', 'ram'],
  }),
  step('queue', {
    category: 'data',
    outline: { path: 'M {w * 0.1} 0 H {w * 0.9} A {w * 0.1} {h/2} 0 0 1 {w * 0.9} {h} H {w * 0.1} A {w * 0.1} {h/2} 0 0 1 {w * 0.1} 0 Z' },
    decorations: [{ path: 'M {w * 0.9} 0 A {w * 0.1} {h/2} 0 0 0 {w * 0.9} {h}' }],
    textRegions: [{ name: 'body', x: 0.1, y: 0.15, w: 0.7, h: 0.7 }],
    defaultSize: { w: 170, h: 70 },
    describe: 'A queue: messages or items waiting in order, drawn as a horizontal drum.',
    keywords: ['queue', 'buffer', 'messages', 'fifo', 'sequential'],
  }),
  step('display', {
    category: 'data',
    outline: { path: 'M 0 {h/2} L {w * 0.2} 0 H {w * 0.85} A {w * 0.15} {h/2} 0 0 1 {w * 0.85} {h} H {w * 0.2} Z' },
    textRegions: [{ name: 'body', x: 0.2, y: 0.15, w: 0.65, h: 0.7 }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A display: information shown on a screen.',
    keywords: ['display', 'screen', 'monitor', 'show'],
  }),
  step('card', {
    category: 'data',
    outline: { path: 'M {w * 0.2} 0 H {w} V {h} H 0 V {h * 0.3} Z' },
    defaultSize: { w: 140, h: 90 },
    describe: 'A card: a punched card or a record.',
    keywords: ['card', 'punched', 'record'],
  }),
  step('connector', {
    category: 'flow',
    outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 0 1 {w} {h/2} A {w/2} {h/2} 0 0 1 0 {h/2} Z' },
    textRegions: [{ name: 'body', x: 0.15, y: 0.15, w: 0.7, h: 0.7 }],
    defaultSize: { w: 50, h: 50 },
    describe: 'An on-page connector: a labelled jump to another point on the same page.',
    keywords: ['connector', 'jump', 'reference', 'circle'],
  }),
  step('off-page-connector', {
    category: 'flow',
    outline: { path: 'M 0 0 H {w} V {h * 0.6} L {w/2} {h} L 0 {h * 0.6} Z' },
    textRegions: [{ name: 'body', x: 0.1, y: 0.1, w: 0.8, h: 0.5 }],
    defaultSize: { w: 60, h: 70 },
    describe: 'An off-page connector: the flow continues on another page.',
    keywords: ['off-page', 'connector', 'continue', 'page'],
  }),
  step('merge', {
    category: 'flow',
    outline: { path: 'M 0 0 H {w} L {w/2} {h} Z' },
    textRegions: [{ name: 'body', x: 0.25, y: 0.1, w: 0.5, h: 0.4 }],
    defaultSize: { w: 80, h: 70 },
    describe: 'Merge: several flows or sets combined into one.',
    keywords: ['merge', 'combine', 'join', 'triangle'],
  }),
  step('extract', {
    category: 'flow',
    outline: { path: 'M {w/2} 0 L {w} {h} H 0 Z' },
    textRegions: [{ name: 'body', x: 0.25, y: 0.5, w: 0.5, h: 0.4 }],
    defaultSize: { w: 80, h: 70 },
    describe: 'Extract: one set split out of another.',
    keywords: ['extract', 'split', 'triangle'],
  }),
  step('summing-junction', {
    category: 'flow',
    outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 0 1 {w} {h/2} A {w/2} {h/2} 0 0 1 0 {h/2} Z' },
    decorations: [{ path: 'M {w * 0.146} {h * 0.146} L {w * 0.854} {h * 0.854}' }, { path: 'M {w * 0.854} {h * 0.146} L {w * 0.146} {h * 0.854}' }],
    defaultSize: { w: 50, h: 50 },
    describe: 'A summing junction: flows that must all arrive (logical AND).',
    keywords: ['summing', 'junction', 'and', 'join'],
  }),
  step('or', {
    category: 'flow',
    outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 0 1 {w} {h/2} A {w/2} {h/2} 0 0 1 0 {h/2} Z' },
    decorations: [{ path: 'M {w/2} 0 V {h}' }, { path: 'M 0 {h/2} H {w}' }],
    defaultSize: { w: 50, h: 50 },
    describe: 'An or junction: any one of the incoming flows continues (logical OR).',
    keywords: ['or', 'junction', 'any'],
  }),
  step('annotation', {
    category: 'flow',
    // an open bracket: the outline is the stroke, and the text sits beside it
    outline: { path: 'M {w * 0.15} 0 H 0 V {h} H {w * 0.15}' },
    defaultStyle: { fill: 'transparent' },
    textRegions: [{ name: 'body', x: 0.08, y: 0.05, w: 0.9, h: 0.9 }],
    defaultSize: { w: 140, h: 70 },
    describe: 'An annotation: a comment bracket attached to a step.',
    keywords: ['annotation', 'comment', 'note', 'bracket'],
  }),
];
