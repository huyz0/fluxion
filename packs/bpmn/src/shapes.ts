// BPMN-lite (FR-LIB-007): the activities, events, gateways, data and swimlanes most process maps use, as declarative
// templates drawn for Fluxion (ADR-0016). Markers are stroke-only decorations; event kinds differ by border and inner mark.
import type { ShapeDef } from '@fluxion/sdk';

const bpmn = (id: string, category: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'>): ShapeDef => ({
  id: `bpmn:${id}`,
  ...def,
  category,
  license: 'MIT',
});

/** An activity's corner radius: 10 units, smaller in a small box. */
const rr = 'min(10, w * 0.1, h * 0.15)';
const rounded = (r: string, inset = '0') =>
  `M {${inset} + ${r}} {${inset}} H {w - ${inset} - ${r}} A {${r}} {${r}} 0 0 1 {w - ${inset}} {${inset} + ${r}} V {h - ${inset} - ${r}} ` +
  `A {${r}} {${r}} 0 0 1 {w - ${inset} - ${r}} {h - ${inset}} H {${inset} + ${r}} A {${r}} {${r}} 0 0 1 {${inset}} {h - ${inset} - ${r}} ` +
  `V {${inset} + ${r}} A {${r}} {${r}} 0 0 1 {${inset} + ${r}} {${inset}} Z`;
/** An ellipse of radii `rx`, `ry` about the box centre. */
const ellipse = (rx: string, ry: string) =>
  `M {w/2 - (${rx})} {h/2} A {${rx}} {${ry}} 0 1 1 {w/2 + (${rx})} {h/2} A {${rx}} {${ry}} 0 1 1 {w/2 - (${rx})} {h/2} Z`;
const circle = ellipse('w/2', 'h/2');
const diamond = 'M {w/2} 0 L {w} {h/2} L {w/2} {h} L 0 {h/2} Z';
/** A collapsed-subprocess marker: a small square with a plus, centred on the bottom edge. */
const m = 'min(14, w * 0.15, h * 0.25)';
const plusBox = `M {w/2 - ${m}/2} {h - ${m} - 2} H {w/2 + ${m}/2} V {h - 2} H {w/2 - ${m}/2} Z`;
const plusV = `M {w/2} {h - ${m} * 0.8 - 2} V {h - ${m} * 0.2 - 2}`;
const plusH = `M {w/2 - ${m} * 0.3} {h - ${m}/2 - 2} H {w/2 + ${m} * 0.3}`;
/** A gateway mark's half-size: a quarter of the diamond. */
const gx = 'w * 0.2';
const gy = 'h * 0.2';
/** A data object's folded corner. */
const fold = 'min(14, w / 3, h / 4)';
/** A data store's lid depth. */
const lid = 'min(12, h * 0.15)';
/** A pool's name band. */
const band = 'min(30, h / 4)';
/** Events and gateways, as BPMN draws them, carry their label below the symbol. */
const below = {
  defaultStyle: { font: { verticalAlign: 'top' } },
  textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
} as const;

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  bpmn('task', 'activities', {
    outline: { path: rounded(rr) },
    textRegions: [{ name: 'body', x: 0.06, y: 0.08, w: 0.88, h: 0.84 }],
    defaultSize: { w: 140, h: 80 },
    describe: 'A task: one unit of work done by a person or a system.',
    keywords: ['task', 'activity', 'step', 'work', 'bpmn'],
  }),
  bpmn('subprocess', 'activities', {
    outline: { path: rounded(rr) },
    decorations: [{ path: plusBox }, { path: plusV }, { path: plusH }],
    textRegions: [{ name: 'body', x: 0.06, y: 0.08, w: 0.88, h: `max(0, 1 - (${m} + 8) / h)` }],
    defaultSize: { w: 140, h: 80 },
    describe: 'A collapsed sub-process: an activity with its own detailed flow, marked with a plus.',
    keywords: ['subprocess', 'sub-process', 'collapsed', 'activity', 'bpmn'],
  }),
  bpmn('call-activity', 'activities', {
    outline: { path: rounded(rr) },
    defaultStyle: { stroke: { width: 4 } },
    textRegions: [{ name: 'body', x: 0.06, y: 0.08, w: 0.88, h: 0.84 }],
    defaultSize: { w: 140, h: 80 },
    describe: 'A call activity (thick border): reuses a process or task defined elsewhere.',
    keywords: ['call activity', 'reusable', 'global task', 'activity', 'bpmn'],
  }),
  bpmn('transaction', 'activities', {
    outline: { path: rounded(rr) },
    decorations: [{ path: rounded(`max(0, ${rr} - 3)`, '4') }],
    textRegions: [{ name: 'body', x: 0.08, y: 0.1, w: 0.84, h: 0.8 }],
    defaultSize: { w: 140, h: 80 },
    describe: 'A transaction (double border): a sub-process whose steps succeed or are undone together.',
    keywords: ['transaction', 'compensation', 'atomic', 'subprocess', 'bpmn'],
  }),
  bpmn('start-event', 'events', {
    outline: { path: circle },
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A start event (thin circle): where the process begins.',
    keywords: ['start', 'event', 'begin', 'trigger', 'bpmn'],
  }),
  bpmn('intermediate-event', 'events', {
    outline: { path: circle },
    decorations: [{ path: ellipse('w/2 - 4', 'h/2 - 4') }],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'An intermediate event (double circle): something that happens during the process.',
    keywords: ['intermediate', 'event', 'catch', 'throw', 'bpmn'],
  }),
  bpmn('end-event', 'events', {
    outline: { path: circle },
    ...below,
    defaultStyle: { stroke: { width: 4 }, font: { verticalAlign: 'top' } },
    defaultSize: { w: 48, h: 48 },
    describe: 'An end event (thick circle): where a path of the process finishes.',
    keywords: ['end', 'event', 'finish', 'terminate', 'bpmn'],
  }),
  bpmn('timer-event', 'events', {
    outline: { path: circle },
    decorations: [
      { path: ellipse('w/2 - 4', 'h/2 - 4') },
      { path: ellipse('w * 0.3', 'h * 0.3') },
      { path: 'M {w/2} {h * 0.28} V {h/2} L {w * 0.64} {h * 0.58}' },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A timer event: the process waits for a date, time or interval.',
    keywords: ['timer', 'clock', 'wait', 'schedule', 'event', 'bpmn'],
  }),
  bpmn('message-event', 'events', {
    outline: { path: circle },
    decorations: [
      { path: ellipse('w/2 - 4', 'h/2 - 4') },
      { path: 'M {w * 0.3} {h * 0.34} H {w * 0.7} V {h * 0.66} H {w * 0.3} Z' },
      { path: 'M {w * 0.3} {h * 0.34} L {w/2} {h/2} L {w * 0.7} {h * 0.34}' },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A message event (envelope): the process sends or waits for a message.',
    keywords: ['message', 'envelope', 'email', 'signal', 'event', 'bpmn'],
  }),
  bpmn('exclusive-gateway', 'gateways', {
    outline: { path: diamond },
    decorations: [
      { path: `M {w/2 - ${gx} * 0.7} {h/2 - ${gy} * 0.7} L {w/2 + ${gx} * 0.7} {h/2 + ${gy} * 0.7}` },
      { path: `M {w/2 + ${gx} * 0.7} {h/2 - ${gy} * 0.7} L {w/2 - ${gx} * 0.7} {h/2 + ${gy} * 0.7}` },
    ],
    ...below,
    defaultSize: { w: 56, h: 56 },
    describe: 'An exclusive gateway (X): exactly one outgoing path is taken.',
    keywords: ['exclusive', 'xor', 'gateway', 'decision', 'branch', 'bpmn'],
  }),
  bpmn('parallel-gateway', 'gateways', {
    outline: { path: diamond },
    decorations: [{ path: `M {w/2} {h/2 - ${gy}} V {h/2 + ${gy}}` }, { path: `M {w/2 - ${gx}} {h/2} H {w/2 + ${gx}}` }],
    ...below,
    defaultSize: { w: 56, h: 56 },
    describe: 'A parallel gateway (+): all paths run at once, or wait for each other to join.',
    keywords: ['parallel', 'and', 'gateway', 'fork', 'join', 'bpmn'],
  }),
  bpmn('inclusive-gateway', 'gateways', {
    outline: { path: diamond },
    decorations: [{ path: ellipse(gx, gy) }],
    ...below,
    defaultSize: { w: 56, h: 56 },
    describe: 'An inclusive gateway (O): one or more outgoing paths are taken.',
    keywords: ['inclusive', 'or', 'gateway', 'condition', 'bpmn'],
  }),
  bpmn('event-gateway', 'gateways', {
    outline: { path: diamond },
    decorations: [
      { path: ellipse('w * 0.24', 'h * 0.24') },
      { path: ellipse('w * 0.2', 'h * 0.2') },
      {
        path:
          'M {w/2} {h/2 - h * 0.12} L {w/2 + w * 0.114} {h/2 - h * 0.037} L {w/2 + w * 0.071} {h/2 + h * 0.097} ' +
          'L {w/2 - w * 0.071} {h/2 + h * 0.097} L {w/2 - w * 0.114} {h/2 - h * 0.037} Z',
      },
    ],
    ...below,
    defaultSize: { w: 56, h: 56 },
    describe: 'An event-based gateway: the path taken is the one whose event happens first.',
    keywords: ['event-based', 'gateway', 'race', 'wait', 'bpmn'],
  }),
  bpmn('data-object', 'data', {
    outline: { path: `M 0 0 H {w - ${fold}} L {w} {${fold}} V {h} H 0 Z` },
    decorations: [{ path: `M {w - ${fold}} 0 V {${fold}} H {w}` }],
    textRegions: [{ name: 'body', x: 0.08, y: `min(1, (${fold} + 2) / h)`, w: 0.84, h: `max(0, 1 - (${fold} + 6) / h)` }],
    defaultSize: { w: 60, h: 76 },
    describe: 'A data object (folded page): information an activity reads or produces.',
    keywords: ['data', 'document', 'object', 'file', 'input', 'output', 'bpmn'],
  }),
  bpmn('data-store', 'data', {
    outline: {
      path: `M 0 {${lid}} A {w/2} {${lid}} 0 0 1 {w} {${lid}} V {h - ${lid}} A {w/2} {${lid}} 0 0 1 0 {h - ${lid}} Z`,
    },
    decorations: [{ path: `M 0 {${lid}} A {w/2} {${lid}} 0 0 0 {w} {${lid}}` }],
    textRegions: [{ name: 'body', x: 0.06, y: `2 * ${lid} / h`, w: 0.88, h: `1 - 3 * ${lid} / h` }],
    defaultSize: { w: 80, h: 70 },
    describe: 'A data store (cylinder): a database or other place data persists beyond the process.',
    keywords: ['data store', 'database', 'storage', 'persist', 'bpmn'],
  }),
  bpmn('pool', 'swimlanes', {
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    decorations: [{ path: `M 0 {${band}} H {w}` }],
    defaultStyle: { fill: 'transparent', font: { verticalAlign: 'middle' } },
    textRegions: [
      { name: 'name', x: 0.02, y: 0, w: 0.96, h: `${band} / h` },
      { name: 'body', x: 0.02, y: `${band} / h`, w: 0.96, h: `1 - ${band} / h` },
    ],
    defaultSize: { w: 480, h: 180 },
    describe: 'A pool: one participant in the process, with its name in the top band.',
    keywords: ['pool', 'participant', 'swimlane', 'organization', 'bpmn'],
  }),
  bpmn('lane', 'swimlanes', {
    outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
    defaultStyle: { fill: 'transparent', font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'name', x: 0.02, y: 0.02, w: 0.4, h: 0.2 }],
    defaultSize: { w: 480, h: 120 },
    describe: 'A lane: a role or team inside a pool, named at its top left.',
    keywords: ['lane', 'role', 'team', 'swimlane', 'responsibility', 'bpmn'],
  }),
  bpmn('group', 'artifacts', {
    outline: { path: rounded(rr) },
    defaultStyle: { fill: 'transparent', stroke: { dash: [8, 4] }, font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'name', x: 0.04, y: 0.04, w: 0.92, h: 0.2 }],
    defaultSize: { w: 240, h: 160 },
    describe: 'A group (dashed): marks related elements without changing the flow.',
    keywords: ['group', 'cluster', 'dashed', 'category', 'artifact', 'bpmn'],
  }),
  bpmn('annotation', 'artifacts', {
    // the bracket is the outline itself, open on the right: an annotation has no border on its text side
    outline: { path: 'M {min(16, w * 0.2)} 0 H 0 V {h} H {min(16, w * 0.2)}' },
    defaultStyle: { fill: 'transparent' },
    textRegions: [{ name: 'body', x: 0.06, y: 0.06, w: 0.9, h: 0.88 }],
    defaultSize: { w: 160, h: 60 },
    describe: 'A text annotation: a note attached to an element, drawn as an open bracket.',
    keywords: ['annotation', 'note', 'comment', 'text', 'artifact', 'bpmn'],
  }),
];
