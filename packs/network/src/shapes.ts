// Network (FR-LIB-007): generic infrastructure symbols for network and deployment maps, as declarative templates drawn
// for Fluxion (ADR-0016). No vendor artwork (ADR-0050). Marks are stroke-only decorations, one subpath each.
import type { ShapeDef } from '@fluxion/sdk';

const net = (id: string, category: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'>): ShapeDef => ({
  id: `network:${id}`,
  ...def,
  category,
  license: 'MIT',
});

const box = 'M 0 0 H {w} V {h} H 0 Z';
const ellipse = (cx: string, cy: string, rx: string, ry: string) =>
  `M {${cx} - (${rx})} {${cy}} A {${rx}} {${ry}} 0 1 1 {${cx} + (${rx})} {${cy}} A {${rx}} {${ry}} 0 1 1 {${cx} - (${rx})} {${cy}} Z`;
/** The box with corner radius `r`. */
const rounded = (r: string) =>
  `M {${r}} 0 H {w - ${r}} A {${r}} {${r}} 0 0 1 {w} {${r}} V {h - ${r}} A {${r}} {${r}} 0 0 1 {w - ${r}} {h} H {${r}} ` +
  `A {${r}} {${r}} 0 0 1 0 {h - ${r}} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`;
/** A horizontal arrow shaft from x0 to x1 at height y. */
const shaft = (x0: string, x1: string, y: string) => `M {${x0}} {${y}} H {${x1}}`;
/** An arrowhead `a` long at (x1, y), pointing right (1) or left (-1). */
const head = (x1: string, y: string, a: string, dir: 1 | -1) =>
  `M {${x1} - ${dir} * ${a}} {${y} - ${a}} L {${x1}} {${y}} L {${x1} - ${dir} * ${a}} {${y} + ${a}}`;
/** Compass anchors on the drawn body: north at `ny`, east and west at `ey` inset by `ex`, south at `sy`. */
const compass = (ny: number, ey: number, ex: number, sy: number) => [
  { name: 'n', x: 0.5, y: ny, dir: { x: 0, y: -1 } },
  { name: 'e', x: 1 - ex, y: ey, dir: { x: 1, y: 0 } },
  { name: 's', x: 0.5, y: sy, dir: { x: 0, y: 1 } },
  { name: 'w', x: ex, y: ey, dir: { x: -1, y: 0 } },
];
/** Label below a symbol, as icons in network maps carry it. */
const below = {
  defaultStyle: { font: { verticalAlign: 'top' } },
  textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
} as const;
/** A rack unit's height in a server or rack. */
const u = 'h / 4';

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  net('router', 'devices', {
    // a disc seen from the side: the classic router puck, with two crossing strokes on its top
    outline: { path: `M 0 {h * 0.3} A {w/2} {h * 0.3} 0 0 1 {w} {h * 0.3} V {h * 0.7} A {w/2} {h * 0.3} 0 0 1 0 {h * 0.7} Z` },
    decorations: [
      { path: 'M 0 {h * 0.3} A {w/2} {h * 0.3} 0 0 0 {w} {h * 0.3}' },
      { path: 'M {w * 0.3} {h * 0.18} L {w * 0.7} {h * 0.42}' },
      { path: 'M {w * 0.7} {h * 0.18} L {w * 0.3} {h * 0.42}' },
    ],
    ...below,
    defaultSize: { w: 72, h: 48 },
    describe: 'A router: forwards traffic between networks.',
    keywords: ['router', 'gateway', 'layer 3', 'routing', 'network'],
  }),
  net('switch', 'devices', {
    outline: { path: box },
    decorations: [
      { path: shaft('w * 0.15', 'w * 0.85', 'h * 0.33') },
      { path: head('w * 0.85', 'h * 0.33', 'h * 0.12', 1) },
      { path: shaft('w * 0.85', 'w * 0.15', 'h * 0.67') },
      { path: head('w * 0.15', 'h * 0.67', 'h * 0.12', -1) },
    ],
    ...below,
    defaultSize: { w: 80, h: 40 },
    describe: 'A switch: connects devices on one network and forwards frames between them.',
    keywords: ['switch', 'layer 2', 'ethernet', 'lan', 'network'],
  }),
  net('hub', 'devices', {
    outline: { path: box },
    decorations: [
      { path: 'M {w * 0.15} {h/2} H {w * 0.85}' },
      { path: 'M {w * 0.3} {h * 0.25} V {h * 0.75}' },
      { path: 'M {w * 0.7} {h * 0.25} V {h * 0.75}' },
    ],
    ...below,
    defaultSize: { w: 80, h: 32 },
    describe: 'A hub or patch panel: a shared connection point for several links.',
    keywords: ['hub', 'patch panel', 'repeater', 'network'],
  }),
  net('firewall', 'security', {
    // a brick wall: courses as horizontal lines, joints offset course by course
    outline: { path: box },
    decorations: [
      { path: 'M 0 {h / 3} H {w}' },
      { path: 'M 0 {h * 2 / 3} H {w}' },
      { path: 'M {w / 2} 0 V {h / 3}' },
      { path: 'M {w / 4} {h / 3} V {h * 2 / 3}' },
      { path: 'M {w * 3 / 4} {h / 3} V {h * 2 / 3}' },
      { path: 'M {w / 2} {h * 2 / 3} V {h}' },
    ],
    ...below,
    defaultSize: { w: 64, h: 48 },
    describe: 'A firewall: filters traffic between zones by policy.',
    keywords: ['firewall', 'security', 'filter', 'policy', 'wall', 'network'],
  }),
  net('load-balancer', 'devices', {
    outline: { path: rounded('min(8, w * 0.1, h * 0.2)') },
    decorations: [
      { path: 'M {w * 0.15} {h/2} H {w * 0.45}' },
      { path: 'M {w * 0.45} {h/2} L {w * 0.85} {h * 0.25}' },
      { path: 'M {w * 0.45} {h/2} H {w * 0.85}' },
      { path: 'M {w * 0.45} {h/2} L {w * 0.85} {h * 0.75}' },
    ],
    ...below,
    defaultSize: { w: 80, h: 44 },
    describe: 'A load balancer: spreads incoming requests across several servers.',
    keywords: ['load balancer', 'balancing', 'proxy', 'distribution', 'network'],
  }),
  net('server', 'hosts', {
    outline: { path: box },
    decorations: [
      { path: `M 0 {${u}} H {w}` },
      { path: `M 0 {2 * ${u}} H {w}` },
      { path: `M 0 {3 * ${u}} H {w}` },
      { path: `M {w * 0.12} {${u} / 2} H {w * 0.4}` },
      { path: `M {w * 0.12} {1.5 * ${u}} H {w * 0.4}` },
      { path: `M {w * 0.12} {2.5 * ${u}} H {w * 0.4}` },
      { path: `M {w * 0.12} {3.5 * ${u}} H {w * 0.4}` },
    ],
    ...below,
    defaultSize: { w: 48, h: 72 },
    describe: 'A server: a host that runs services for others.',
    keywords: ['server', 'host', 'machine', 'compute', 'tower'],
  }),
  net('rack', 'hosts', {
    outline: { path: box },
    decorations: [
      { path: 'M {w * 0.1} {h * 0.05} H {w * 0.9} V {h * 0.95} H {w * 0.1} Z' },
      { path: 'M {w * 0.1} {h * 0.25} H {w * 0.9}' },
      { path: 'M {w * 0.1} {h * 0.45} H {w * 0.9}' },
      { path: 'M {w * 0.1} {h * 0.65} H {w * 0.9}' },
    ],
    ...below,
    defaultSize: { w: 56, h: 96 },
    describe: 'A rack or cabinet holding several servers and network devices.',
    keywords: ['rack', 'cabinet', 'data center', 'servers', 'hosting'],
  }),
  net('storage', 'hosts', {
    outline: { path: box },
    decorations: [
      { path: 'M 0 {h / 3} H {w}' },
      { path: 'M 0 {h * 2 / 3} H {w}' },
      { path: ellipse('w * 0.8', 'h / 6', 'min(w, h) * 0.05', 'min(w, h) * 0.05') },
      { path: ellipse('w * 0.8', 'h / 2', 'min(w, h) * 0.05', 'min(w, h) * 0.05') },
      { path: ellipse('w * 0.8', 'h * 5 / 6', 'min(w, h) * 0.05', 'min(w, h) * 0.05') },
    ],
    ...below,
    defaultSize: { w: 72, h: 54 },
    describe: 'Network storage (NAS or SAN): disks shared over the network.',
    keywords: ['storage', 'nas', 'san', 'disk', 'array', 'backup'],
  }),
  net('access-point', 'devices', {
    outline: { path: 'M 0 {h * 0.6} H {w} V {h} H 0 Z' },
    decorations: [
      { path: 'M {w * 0.3} {h * 0.4} A {w * 0.2} {h * 0.2} 0 0 1 {w * 0.7} {h * 0.4}' },
      { path: 'M {w * 0.15} {h * 0.3} A {w * 0.35} {h * 0.3} 0 0 1 {w * 0.85} {h * 0.3}' },
      { path: 'M {w/2} {h * 0.6} V {h * 0.45}' },
    ],
    anchors: compass(0, 0.8, 0, 1),
    ...below,
    defaultSize: { w: 64, h: 48 },
    describe: 'A wireless access point: connects Wi-Fi clients to the wired network.',
    keywords: ['access point', 'wifi', 'wireless', 'wlan', 'hotspot'],
  }),
  net('internet', 'zones', {
    outline: {
      path:
        'M {w * 0.25} {h * 0.85} A {w * 0.2} {h * 0.25} 0 0 1 {w * 0.15} {h * 0.42} A {w * 0.2} {h * 0.25} 0 0 1 {w * 0.42} {h * 0.18} ' +
        'A {w * 0.25} {h * 0.28} 0 0 1 {w * 0.8} {h * 0.3} A {w * 0.18} {h * 0.25} 0 0 1 {w * 0.8} {h * 0.85} Z',
    },
    // the cloud is lopsided: its left lobe sits further in than its right
    anchors: [
      { name: 'n', x: 0.5, y: 0.12, dir: { x: 0, y: -1 } },
      { name: 'e', x: 0.99, y: 0.6, dir: { x: 1, y: 0 } },
      { name: 's', x: 0.5, y: 0.85, dir: { x: 0, y: 1 } },
      { name: 'w', x: 0.085, y: 0.6, dir: { x: -1, y: 0 } },
    ],
    textRegions: [{ name: 'body', x: 0.2, y: 0.35, w: 0.6, h: 0.45 }],
    defaultSize: { w: 120, h: 72 },
    describe: 'The internet or any external network, drawn as a cloud.',
    keywords: ['internet', 'cloud', 'wan', 'external', 'network'],
  }),
  net('subnet', 'zones', {
    outline: { path: rounded('min(12, w * 0.1, h * 0.1)') },
    defaultStyle: { fill: 'transparent', stroke: { dash: [8, 4] }, font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'name', x: 0.03, y: 0.03, w: 0.6, h: 0.15 }],
    defaultSize: { w: 280, h: 180 },
    describe: 'A subnet, VLAN or security zone (dashed): groups the hosts inside it.',
    keywords: ['subnet', 'vlan', 'zone', 'dmz', 'segment', 'network'],
  }),
  net('bus', 'zones', {
    // a shared segment: a long bar that taps connect to
    outline: { path: box },
    defaultStyle: { font: { verticalAlign: 'top' } },
    textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
    defaultSize: { w: 320, h: 8 },
    describe: 'A network segment or backbone: a bar hosts tap into.',
    keywords: ['bus', 'segment', 'backbone', 'ethernet', 'trunk'],
  }),
  net('modem', 'devices', {
    outline: { path: 'M 0 {h * 0.35} H {w} V {h} H 0 Z' },
    decorations: [
      { path: 'M {w * 0.2} {h * 0.35} L {w * 0.15} 0' },
      { path: 'M {w * 0.8} {h * 0.35} L {w * 0.85} 0' },
      { path: ellipse('w * 0.2', 'h * 0.68', 'min(w, h) * 0.05', 'min(w, h) * 0.05') },
      { path: ellipse('w * 0.35', 'h * 0.68', 'min(w, h) * 0.05', 'min(w, h) * 0.05') },
      { path: ellipse('w * 0.5', 'h * 0.68', 'min(w, h) * 0.05', 'min(w, h) * 0.05') },
    ],
    anchors: compass(0.35, 0.675, 0, 1),
    ...below,
    defaultSize: { w: 72, h: 44 },
    describe: 'A modem or customer edge device: links the site to its provider.',
    keywords: ['modem', 'cpe', 'edge', 'isp', 'broadband'],
  }),
  net('vpn', 'security', {
    // a padlock: shackle arc over a body
    outline: { path: 'M {w * 0.1} {h * 0.45} H {w * 0.9} V {h} H {w * 0.1} Z' },
    decorations: [
      { path: 'M {w * 0.28} {h * 0.45} V {h * 0.3} A {w * 0.22} {h * 0.22} 0 0 1 {w * 0.72} {h * 0.3} V {h * 0.45}' },
      { path: 'M {w/2} {h * 0.65} V {h * 0.8}' },
    ],
    anchors: compass(0.08, 0.725, 0.1, 1),
    ...below,
    defaultSize: { w: 48, h: 56 },
    describe: 'A VPN or encrypted tunnel endpoint, drawn as a padlock.',
    keywords: ['vpn', 'tunnel', 'encryption', 'lock', 'secure', 'ipsec'],
  }),
];
