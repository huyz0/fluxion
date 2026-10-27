// Cloud architecture (FR-LIB-007): generic service symbols for cloud and system architecture diagrams, as declarative
// templates drawn for Fluxion (ADR-0016). Provider-neutral by design: no vendor artwork, colours or names (ADR-0050).
// Each symbol is a rounded tile with a stroke-only mark; boundaries are dashed, label at the top left.
import type { ShapeDef } from '@fluxion/sdk';

const cloud = (id: string, category: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'>): ShapeDef => ({
  id: `cloud:${id}`,
  ...def,
  category,
  license: 'MIT',
});

/** A tile's corner radius. */
const r = 'min(8, w * 0.12, h * 0.12)';
const tile = `M {${r}} 0 H {w - ${r}} A {${r}} {${r}} 0 0 1 {w} {${r}} V {h - ${r}} A {${r}} {${r}} 0 0 1 {w - ${r}} {h} H {${r}} A {${r}} {${r}} 0 0 1 0 {h - ${r}} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`;
const ellipse = (cx: string, cy: string, rx: string, ry: string) =>
  `M {${cx} - (${rx})} {${cy}} A {${rx}} {${ry}} 0 1 1 {${cx} + (${rx})} {${cy}} A {${rx}} {${ry}} 0 1 1 {${cx} - (${rx})} {${cy}} Z`;
/** Fractions of the tile, written as template coordinates. */
const X = (f: number) => `{w * ${f}}`;
const Y = (f: number) => `{h * ${f}}`;
/** Symbols carry their label below the tile. */
const below = {
  defaultStyle: { font: { verticalAlign: 'top' } },
  textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
} as const;
const size = { w: 56, h: 56 };
/** A dashed boundary with its name at the top left. */
const boundary = (dash: readonly number[], cap: 'butt' | 'round' = 'butt') =>
  ({
    outline: { path: tile },
    defaultStyle: { fill: 'transparent', stroke: { dash, cap }, font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'name', x: 0.03, y: 0.03, w: 0.6, h: 0.12 }],
  }) as const;

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  cloud('compute', 'compute', {
    outline: { path: tile },
    // a chip: a square die with pins on each side
    decorations: [
      { path: `M ${X(0.3)} ${Y(0.3)} H ${X(0.7)} V ${Y(0.7)} H ${X(0.3)} Z` },
      { path: `M ${X(0.4)} ${Y(0.3)} V ${Y(0.18)}` },
      { path: `M ${X(0.6)} ${Y(0.3)} V ${Y(0.18)}` },
      { path: `M ${X(0.4)} ${Y(0.7)} V ${Y(0.82)}` },
      { path: `M ${X(0.6)} ${Y(0.7)} V ${Y(0.82)}` },
      { path: `M ${X(0.3)} ${Y(0.4)} H ${X(0.18)}` },
      { path: `M ${X(0.3)} ${Y(0.6)} H ${X(0.18)}` },
      { path: `M ${X(0.7)} ${Y(0.4)} H ${X(0.82)}` },
      { path: `M ${X(0.7)} ${Y(0.6)} H ${X(0.82)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A compute instance or virtual machine.',
    keywords: ['compute', 'vm', 'virtual machine', 'instance', 'server', 'cloud'],
  }),
  cloud('container', 'compute', {
    outline: { path: tile },
    // a shipping box: an isometric cube
    decorations: [
      { path: `M ${X(0.5)} ${Y(0.2)} L ${X(0.78)} ${Y(0.34)} V ${Y(0.66)} L ${X(0.5)} ${Y(0.8)} L ${X(0.22)} ${Y(0.66)} V ${Y(0.34)} Z` },
      { path: `M ${X(0.22)} ${Y(0.34)} L ${X(0.5)} ${Y(0.48)} L ${X(0.78)} ${Y(0.34)}` },
      { path: `M ${X(0.5)} ${Y(0.48)} V ${Y(0.8)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A container or container workload.',
    keywords: ['container', 'pod', 'image', 'workload', 'cloud'],
  }),
  cloud('function', 'compute', {
    outline: { path: tile },
    // a lightning bolt: code that runs on an event
    decorations: [{ path: `M ${X(0.56)} ${Y(0.16)} L ${X(0.3)} ${Y(0.54)} H ${X(0.5)} L ${X(0.44)} ${Y(0.84)} L ${X(0.7)} ${Y(0.44)} H ${X(0.5)} Z` }],
    ...below,
    defaultSize: size,
    describe: 'A serverless function: code that runs on demand, per event.',
    keywords: ['function', 'serverless', 'faas', 'event', 'cloud'],
  }),
  cloud('cluster', 'compute', {
    outline: { path: tile },
    // three linked nodes
    decorations: [
      { path: ellipse('w * 0.5', 'h * 0.28', 'w * 0.1', 'h * 0.1') },
      { path: ellipse('w * 0.28', 'h * 0.7', 'w * 0.1', 'h * 0.1') },
      { path: ellipse('w * 0.72', 'h * 0.7', 'w * 0.1', 'h * 0.1') },
      { path: `M ${X(0.44)} ${Y(0.36)} L ${X(0.34)} ${Y(0.62)}` },
      { path: `M ${X(0.56)} ${Y(0.36)} L ${X(0.66)} ${Y(0.62)}` },
      { path: `M ${X(0.38)} ${Y(0.7)} H ${X(0.62)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A cluster or orchestrator managing a group of nodes.',
    keywords: ['cluster', 'orchestration', 'nodes', 'scheduler', 'cloud'],
  }),
  cloud('object-storage', 'storage', {
    outline: { path: tile },
    // a bucket: a tapered pail with a rim
    decorations: [
      { path: `M ${X(0.22)} ${Y(0.3)} H ${X(0.78)} L ${X(0.7)} ${Y(0.8)} H ${X(0.3)} Z` },
      { path: ellipse('w * 0.5', 'h * 0.3', 'w * 0.28', 'h * 0.07') },
    ],
    ...below,
    defaultSize: size,
    describe: 'Object storage: a bucket of files and blobs.',
    keywords: ['object storage', 'bucket', 'blob', 'files', 'cloud'],
  }),
  cloud('block-storage', 'storage', {
    outline: { path: tile },
    // a disk: a platter with its spindle
    decorations: [{ path: ellipse('w * 0.5', 'h * 0.5', 'w * 0.3', 'h * 0.3') }, { path: ellipse('w * 0.5', 'h * 0.5', 'w * 0.07', 'h * 0.07') }],
    ...below,
    defaultSize: size,
    describe: 'Block storage: a volume attached to a compute instance.',
    keywords: ['block storage', 'volume', 'disk', 'ssd', 'cloud'],
  }),
  cloud('database', 'storage', {
    outline: { path: tile },
    // a cylinder
    decorations: [
      { path: `M ${X(0.25)} ${Y(0.28)} V ${Y(0.72)} A {w * 0.25} {h * 0.08} 0 0 0 ${X(0.75)} ${Y(0.72)} V ${Y(0.28)}` },
      { path: ellipse('w * 0.5', 'h * 0.28', 'w * 0.25', 'h * 0.08') },
      { path: `M ${X(0.25)} ${Y(0.5)} A {w * 0.25} {h * 0.08} 0 0 0 ${X(0.75)} ${Y(0.5)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A managed database.',
    keywords: ['database', 'sql', 'nosql', 'db', 'managed', 'cloud'],
  }),
  cloud('cache', 'storage', {
    outline: { path: tile },
    // a gauge needle at speed
    decorations: [
      { path: `M ${X(0.2)} ${Y(0.66)} A {w * 0.3} {h * 0.3} 0 0 1 ${X(0.8)} ${Y(0.66)}` },
      { path: `M ${X(0.5)} ${Y(0.66)} L ${X(0.68)} ${Y(0.42)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'An in-memory cache for fast reads.',
    keywords: ['cache', 'memory', 'key-value', 'fast', 'cloud'],
  }),
  cloud('queue', 'integration', {
    outline: { path: tile },
    // messages waiting in line
    decorations: [
      { path: `M ${X(0.16)} ${Y(0.38)} H ${X(0.34)} V ${Y(0.62)} H ${X(0.16)} Z` },
      { path: `M ${X(0.41)} ${Y(0.38)} H ${X(0.59)} V ${Y(0.62)} H ${X(0.41)} Z` },
      { path: `M ${X(0.66)} ${Y(0.38)} H ${X(0.84)} V ${Y(0.62)} H ${X(0.66)} Z` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A message queue: work items consumed in order.',
    keywords: ['queue', 'messages', 'fifo', 'buffer', 'cloud'],
  }),
  cloud('pub-sub', 'integration', {
    outline: { path: tile },
    // one source fanning out to three subscribers
    decorations: [
      { path: ellipse('w * 0.26', 'h * 0.5', 'w * 0.08', 'h * 0.08') },
      { path: `M ${X(0.34)} ${Y(0.5)} L ${X(0.74)} ${Y(0.26)}` },
      { path: `M ${X(0.34)} ${Y(0.5)} H ${X(0.74)}` },
      { path: `M ${X(0.34)} ${Y(0.5)} L ${X(0.74)} ${Y(0.74)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A publish/subscribe topic: each message goes to every subscriber.',
    keywords: ['pub/sub', 'topic', 'events', 'broadcast', 'notification', 'cloud'],
  }),
  cloud('api-gateway', 'integration', {
    outline: { path: tile },
    // angle brackets around a slash: the API surface
    decorations: [
      { path: `M ${X(0.34)} ${Y(0.3)} L ${X(0.18)} ${Y(0.5)} L ${X(0.34)} ${Y(0.7)}` },
      { path: `M ${X(0.66)} ${Y(0.3)} L ${X(0.82)} ${Y(0.5)} L ${X(0.66)} ${Y(0.7)}` },
      { path: `M ${X(0.56)} ${Y(0.28)} L ${X(0.44)} ${Y(0.72)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'An API gateway: the managed entry point that routes and secures API calls.',
    keywords: ['api gateway', 'api', 'endpoint', 'rest', 'ingress', 'cloud'],
  }),
  cloud('cdn', 'networking', {
    outline: { path: tile },
    // a globe
    decorations: [
      { path: ellipse('w * 0.5', 'h * 0.5', 'w * 0.3', 'h * 0.3') },
      { path: ellipse('w * 0.5', 'h * 0.5', 'w * 0.12', 'h * 0.3') },
      { path: `M ${X(0.2)} ${Y(0.5)} H ${X(0.8)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'A content delivery network serving content from the edge.',
    keywords: ['cdn', 'edge', 'content delivery', 'globe', 'cache', 'cloud'],
  }),
  cloud('dns', 'networking', {
    outline: { path: tile },
    // a signpost
    decorations: [
      { path: `M ${X(0.5)} ${Y(0.2)} V ${Y(0.82)}` },
      { path: `M ${X(0.5)} ${Y(0.28)} H ${X(0.76)} L ${X(0.84)} ${Y(0.36)} L ${X(0.76)} ${Y(0.44)} H ${X(0.5)}` },
      { path: `M ${X(0.5)} ${Y(0.5)} H ${X(0.24)} L ${X(0.16)} ${Y(0.58)} L ${X(0.24)} ${Y(0.66)} H ${X(0.5)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'DNS: names resolved to addresses.',
    keywords: ['dns', 'domain', 'name resolution', 'routing', 'cloud'],
  }),
  cloud('identity', 'security', {
    outline: { path: tile },
    // a key
    decorations: [
      { path: ellipse('w * 0.32', 'h * 0.5', 'w * 0.12', 'h * 0.12') },
      { path: `M ${X(0.44)} ${Y(0.5)} H ${X(0.82)} V ${Y(0.62)}` },
      { path: `M ${X(0.7)} ${Y(0.5)} V ${Y(0.6)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'Identity and access management: users, roles and keys.',
    keywords: ['identity', 'iam', 'auth', 'key', 'access', 'secrets', 'cloud'],
  }),
  cloud('monitoring', 'operations', {
    outline: { path: tile },
    // a line chart over its axes
    decorations: [
      { path: `M ${X(0.2)} ${Y(0.2)} V ${Y(0.8)} H ${X(0.82)}` },
      { path: `M ${X(0.26)} ${Y(0.66)} L ${X(0.42)} ${Y(0.46)} L ${X(0.56)} ${Y(0.58)} L ${X(0.78)} ${Y(0.3)}` },
    ],
    ...below,
    defaultSize: size,
    describe: 'Monitoring and logging: metrics, logs and alerts.',
    keywords: ['monitoring', 'metrics', 'logging', 'observability', 'alerts', 'cloud'],
  }),
  cloud('region', 'boundaries', {
    ...boundary([10, 5]),
    defaultSize: { w: 420, h: 280 },
    describe: 'A region (dashed): a geographic area that holds the resources inside it.',
    keywords: ['region', 'geography', 'boundary', 'group', 'cloud'],
  }),
  cloud('zone', 'boundaries', {
    // a near-zero dash with a round cap draws a dot
    ...boundary([0.1, 5], 'round'),
    defaultSize: { w: 240, h: 200 },
    describe: 'An availability zone (dotted): an isolated location inside a region.',
    keywords: ['availability zone', 'zone', 'datacenter', 'boundary', 'cloud'],
  }),
  cloud('private-network', 'boundaries', {
    ...boundary([12, 4, 2, 4]),
    defaultSize: { w: 360, h: 240 },
    describe: 'A private network (dash-dot): the isolated network the resources inside it share.',
    keywords: ['private network', 'vpc', 'vnet', 'network', 'boundary', 'cloud'],
  }),
];
