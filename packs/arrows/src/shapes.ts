// The block arrows (FR-LIB-007): filled arrow outlines drawn for Fluxion as declarative templates (ADR-0016). `head` is the
// arrowhead's length as a fraction of the box along the arrow, `shaft` the shaft's thickness as a fraction across it.
import type { ParamSpec, ShapeDef } from '@fluxion/sdk';

const head: ParamSpec = { type: 'number', min: 0.05, max: 0.9, default: 0.35 };
const shaft: ParamSpec = { type: 'number', min: 0.1, max: 1, default: 0.5 };
const params = { head, shaft };

const arrow = (id: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'> & { category?: string }): ShapeDef => ({
  id: `arrows:${id}`,
  ...def,
  category: def.category ?? 'straight',
  license: 'MIT',
});

/** Horizontal: the head length and the shaft's top and bottom edges. */
const hx = 'w * head';
const top = 'h * (1 - shaft) / 2';
const bot = 'h * (1 + shaft) / 2';
/** Vertical: the head length and the shaft's left and right edges. */
const hy = 'h * head';
const lft = 'w * (1 - shaft) / 2';
const rgt = 'w * (1 + shaft) / 2';

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  arrow('right', {
    params,
    outline: { path: `M 0 {${top}} H {w - ${hx}} V 0 L {w} {h/2} L {w - ${hx}} {h} V {${bot}} H 0 Z` },
    handles: [{ param: 'head', x: `w - ${hx}`, y: '0' }],
    textRegions: [{ name: 'body', x: 0.05, y: '(1 - shaft) / 2', w: 0.6, h: 'shaft' }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A block arrow pointing right: direction, progress or next step.',
    keywords: ['arrow', 'right', 'next', 'forward', 'direction'],
  }),
  arrow('left', {
    params,
    outline: { path: `M {w} {${top}} H {${hx}} V 0 L 0 {h/2} L {${hx}} {h} V {${bot}} H {w} Z` },
    handles: [{ param: 'head', x: hx, y: '0' }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A block arrow pointing left: back, previous or return.',
    keywords: ['arrow', 'left', 'back', 'previous', 'direction'],
  }),
  arrow('up', {
    params,
    outline: { path: `M {${lft}} {h} V {${hy}} H 0 L {w/2} 0 L {w} {${hy}} H {${rgt}} V {h} Z` },
    handles: [{ param: 'head', x: '0', y: hy }],
    defaultSize: { w: 80, h: 160 },
    describe: 'A block arrow pointing up: increase, growth or upload.',
    keywords: ['arrow', 'up', 'increase', 'growth', 'direction'],
  }),
  arrow('down', {
    params,
    outline: { path: `M {${lft}} 0 V {h - ${hy}} H 0 L {w/2} {h} L {w} {h - ${hy}} H {${rgt}} V 0 Z` },
    handles: [{ param: 'head', x: '0', y: `h - ${hy}` }],
    defaultSize: { w: 80, h: 160 },
    describe: 'A block arrow pointing down: decrease, decline or download.',
    keywords: ['arrow', 'down', 'decrease', 'decline', 'direction'],
  }),
  arrow('left-right', {
    params: { head: { type: 'number', min: 0.05, max: 0.45, default: 0.25 }, shaft },
    outline: {
      path: `M 0 {h/2} L {${hx}} 0 V {${top}} H {w - ${hx}} V 0 L {w} {h/2} L {w - ${hx}} {h} V {${bot}} H {${hx}} V {h} Z`,
    },
    defaultSize: { w: 180, h: 80 },
    describe: 'A double-headed horizontal arrow: exchange, two-way or range.',
    keywords: ['arrow', 'left', 'right', 'both', 'two-way', 'exchange'],
  }),
  arrow('up-down', {
    params: { head: { type: 'number', min: 0.05, max: 0.45, default: 0.25 }, shaft },
    outline: {
      path: `M {w/2} 0 L {w} {${hy}} H {${rgt}} V {h - ${hy}} H {w} L {w/2} {h} L 0 {h - ${hy}} H {${lft}} V {${hy}} H 0 Z`,
    },
    defaultSize: { w: 80, h: 180 },
    describe: 'A double-headed vertical arrow: up and down, scale or fluctuation.',
    keywords: ['arrow', 'up', 'down', 'both', 'vertical', 'two-way'],
  }),
  arrow('quad', {
    // heads of at most a quarter of the box, so the four never overlap, and at least the widest half-shaft, so each barb flares out
    params: { head: { type: 'number', min: 0.15, max: 0.25, default: 0.2 }, shaft: { type: 'number', min: 0.05, max: 0.3, default: 0.15 } },
    outline: {
      path:
        'M {w/2} 0 L {w/2 + w * head} {h * head} H {w/2 + w * shaft/2} V {h/2 - h * shaft/2} H {w - w * head} V {h/2 - h * head} L {w} {h/2} ' +
        'L {w - w * head} {h/2 + h * head} V {h/2 + h * shaft/2} H {w/2 + w * shaft/2} V {h - h * head} H {w/2 + w * head} L {w/2} {h} ' +
        'L {w/2 - w * head} {h - h * head} H {w/2 - w * shaft/2} V {h/2 + h * shaft/2} H {w * head} V {h/2 + h * head} L 0 {h/2} ' +
        'L {w * head} {h/2 - h * head} V {h/2 - h * shaft/2} H {w/2 - w * shaft/2} V {h * head} H {w/2 - w * head} Z',
    },
    defaultSize: { w: 140, h: 140 },
    describe: 'An arrow pointing four ways: spread, expansion or every direction.',
    keywords: ['arrow', 'quad', 'four', 'all', 'directions', 'move'],
  }),
  arrow('notched-right', {
    params,
    outline: { path: `M 0 {${top}} H {w - ${hx}} V 0 L {w} {h/2} L {w - ${hx}} {h} V {${bot}} H 0 L {w * 0.12} {h/2} Z` },
    defaultSize: { w: 160, h: 80 },
    describe: 'A right arrow with a notched tail: a stage in a sequence.',
    keywords: ['arrow', 'notched', 'right', 'stage', 'sequence'],
  }),
  arrow('striped-right', {
    // the head stops short of the stripes and the shaft's fixed start
    params: { head: { type: 'number', min: 0.05, max: 0.7, default: 0.35 }, shaft },
    outline: { path: `M {w * 0.16} {${top}} H {w - ${hx}} V 0 L {w} {h/2} L {w - ${hx}} {h} V {${bot}} H {w * 0.16} Z` },
    decorations: [{ path: `M 0 {${top}} H {w * 0.04} V {${bot}} H 0 Z` }, { path: `M {w * 0.07} {${top}} H {w * 0.12} V {${bot}} H {w * 0.07} Z` }],
    defaultSize: { w: 160, h: 80 },
    describe: 'A right arrow with a striped tail: speed, momentum or acceleration.',
    keywords: ['arrow', 'striped', 'right', 'speed', 'fast'],
  }),
  arrow('chevron', {
    category: 'process',
    // at most 0.45, so the text region between the notch and the point keeps a positive width
    params: { point: { type: 'number', min: 0.05, max: 0.45, default: 0.25 } },
    outline: { path: 'M 0 0 H {w - w * point} L {w} {h/2} L {w - w * point} {h} H 0 L {w * point} {h/2} Z' },
    handles: [{ param: 'point', x: 'w - w * point', y: '0' }],
    textRegions: [{ name: 'body', x: 'point', y: 0.1, w: '1 - 2 * point', h: 0.8 }],
    defaultSize: { w: 160, h: 70 },
    describe: 'A chevron: one step of a left-to-right process strip.',
    keywords: ['chevron', 'step', 'process', 'stage', 'pipeline'],
  }),
  arrow('pentagon', {
    category: 'process',
    params: { point: { type: 'number', min: 0.05, max: 0.6, default: 0.2 } },
    outline: { path: 'M 0 0 H {w - w * point} L {w} {h/2} L {w - w * point} {h} H 0 Z' },
    handles: [{ param: 'point', x: 'w - w * point', y: '0' }],
    textRegions: [{ name: 'body', x: 0.05, y: 0.1, w: '0.9 - point', h: 0.8 }],
    defaultSize: { w: 160, h: 70 },
    describe: 'A pentagon arrow: the first step or a labelled milestone.',
    keywords: ['pentagon', 'home plate', 'step', 'milestone', 'process'],
  }),
  arrow('bent-right', {
    category: 'bent',
    outline: {
      path: 'M 0 {h} V {h * 0.45} Q 0 {h * 0.25} {w * 0.2} {h * 0.25} H {w * 0.7} V 0 L {w} {h * 0.375} L {w * 0.7} {h * 0.75} V {h * 0.5} H {w * 0.3} Q {w * 0.25} {h * 0.5} {w * 0.25} {h * 0.6} V {h} Z',
    },
    defaultSize: { w: 140, h: 120 },
    describe: 'An arrow that rises and turns right: a change of direction.',
    keywords: ['arrow', 'bent', 'turn', 'right', 'redirect'],
  }),
  arrow('bent-up', {
    category: 'bent',
    outline: { path: 'M 0 {h * 0.75} H {w * 0.625} V {h * 0.3} H {w * 0.5} L {w * 0.75} 0 L {w} {h * 0.3} H {w * 0.875} V {h} H 0 Z' },
    defaultSize: { w: 140, h: 120 },
    describe: 'An arrow that runs right then turns up: escalation or a step up.',
    keywords: ['arrow', 'bent', 'up', 'turn', 'escalate'],
  }),
  arrow('u-turn', {
    category: 'bent',
    outline: {
      path: 'M 0 {h} V {h * 0.4} A {w * 0.35} {h * 0.4} 0 0 1 {w * 0.7} {h * 0.4} V {h * 0.55} H {w * 0.9} L {w * 0.6} {h * 0.9} L {w * 0.3} {h * 0.55} H {w * 0.5} V {h * 0.4} A {w * 0.15} {h * 0.18} 0 0 0 {w * 0.2} {h * 0.4} V {h} Z',
    },
    defaultSize: { w: 120, h: 140 },
    describe: 'A U-turn arrow: reversal, rollback or going back.',
    keywords: ['arrow', 'u-turn', 'reverse', 'back', 'rollback'],
  }),
  arrow('curved-right', {
    category: 'bent',
    outline: {
      path: 'M 0 {h} C 0 {h * 0.45} {w * 0.3} {h * 0.25} {w * 0.7} {h * 0.25} V 0 L {w} {h * 0.375} L {w * 0.7} {h * 0.75} V {h * 0.5} C {w * 0.4} {h * 0.5} {w * 0.25} {h * 0.65} {w * 0.25} {h} Z',
    },
    defaultSize: { w: 150, h: 110 },
    describe: 'A curved arrow sweeping right: a smooth transition or flow.',
    keywords: ['arrow', 'curved', 'curve', 'right', 'flow'],
  }),
  arrow('circular', {
    category: 'bent',
    outline: {
      path: 'M {w * 0.5} {h * 0.0976} A {w * 0.46} {h * 0.4324} 0 1 1 {w * 0.04} {h * 0.53} H {w * 0.22} A {w * 0.28} {h * 0.2632} 0 1 0 {w * 0.5} {h * 0.2668} V {h * 0.3608} L {w * 0.26} {h * 0.1822} L {w * 0.5} 0 Z',
    },
    defaultSize: { w: 120, h: 120 },
    describe: 'A circular arrow: a cycle, refresh, repeat or iteration.',
    keywords: ['arrow', 'circular', 'cycle', 'refresh', 'repeat', 'loop'],
  }),
  arrow('callout-right', {
    category: 'callout',
    outline: { path: 'M 0 0 H {w * 0.6} V {h * 0.3} H {w * 0.75} V {h * 0.12} L {w} {h/2} L {w * 0.75} {h * 0.88} V {h * 0.7} H {w * 0.6} V {h} H 0 Z' },
    textRegions: [{ name: 'body', x: 0.05, y: 0.08, w: 0.5, h: 0.84 }],
    defaultSize: { w: 180, h: 100 },
    describe: 'A box with an arrow out of its right side: a labelled step leading on.',
    keywords: ['arrow', 'callout', 'right', 'box', 'label'],
  }),
  arrow('split', {
    category: 'callout',
    outline: {
      path: 'M 0 {h * 0.4} H {w * 0.4} L {w * 0.6} {h * 0.15} H {w * 0.75} V 0 L {w} {h * 0.22} L {w * 0.75} {h * 0.44} V {h * 0.3} H {w * 0.65} L {w * 0.52} {h/2} L {w * 0.65} {h * 0.7} H {w * 0.75} V {h * 0.56} L {w} {h * 0.78} L {w * 0.75} {h} V {h * 0.85} H {w * 0.6} L {w * 0.4} {h * 0.6} H 0 Z',
    },
    defaultSize: { w: 180, h: 120 },
    describe: 'An arrow that forks in two: a branch, divergence or choice.',
    keywords: ['arrow', 'split', 'fork', 'branch', 'diverge'],
  }),
];
