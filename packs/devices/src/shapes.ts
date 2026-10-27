// Devices (FR-LIB-007): generic end-user hardware for deployment, IoT and user-journey diagrams, as declarative templates
// drawn for Fluxion (ADR-0016). No vendor artwork or product likeness (ADR-0050). Marks are stroke-only decorations, one
// subpath each; every device carries its label below.
import type { ShapeDef } from '@fluxion/sdk';

const device = (id: string, category: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'>): ShapeDef => ({
  id: `devices:${id}`,
  ...def,
  category,
  license: 'MIT',
});

const ellipse = (cx: string, cy: string, rx: string, ry: string) =>
  `M {${cx} - (${rx})} {${cy}} A {${rx}} {${ry}} 0 1 1 {${cx} + (${rx})} {${cy}} A {${rx}} {${ry}} 0 1 1 {${cx} - (${rx})} {${cy}} Z`;
const circle = (cx: string, cy: string, r: string) => ellipse(cx, cy, r, r);
/** The box with corner radius `r`. */
const rounded = (r: string) =>
  `M {${r}} 0 H {w - (${r})} A {${r}} {${r}} 0 0 1 {w} {${r}} V {h - (${r})} A {${r}} {${r}} 0 0 1 {w - (${r})} {h} H {${r}} ` +
  `A {${r}} {${r}} 0 0 1 0 {h - (${r})} V {${r}} A {${r}} {${r}} 0 0 1 {${r}} 0 Z`;
/** A rectangle from (x0, y0) to (x1, y1). */
const rect = (x0: string, y0: string, x1: string, y1: string) => `M {${x0}} {${y0}} H {${x1}} V {${y1}} H {${x0}} Z`;
/** Compass anchors on the drawn body: north at `ny`, east and west at `ey` inset by `ex`, south at `sy`. */
const compass = (ny: number, ey: number, ex: number, sy: number) => [
  { name: 'n', x: 0.5, y: ny, dir: { x: 0, y: -1 } },
  { name: 'e', x: 1 - ex, y: ey, dir: { x: 1, y: 0 } },
  { name: 's', x: 0.5, y: sy, dir: { x: 0, y: 1 } },
  { name: 'w', x: ex, y: ey, dir: { x: -1, y: 0 } },
];
/** Label below a device, as icons in deployment maps carry it. */
const below = {
  defaultStyle: { font: { verticalAlign: 'top' } },
  textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
} as const;
/** Corner radius of handheld devices. */
const handheld = 'min(w, h) * 0.14';
/** Two key rows of a keyboard, one short stroke (subpath) per key; the space bar is drawn on its own. */
const keys = [0.3, 0.5].flatMap((y) => [0.14, 0.29, 0.44, 0.59, 0.74].map((x) => ({ path: `M {w * ${x}} {h * ${y}} H {w * ${x + 0.1}}` })));

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  device('desktop', 'computers', {
    // a monitor on a neck and base, as one silhouette; the screen is an inset decoration
    outline: { path: 'M 0 0 H {w} V {h * 0.75} H {w * 0.58} V {h * 0.88} H {w * 0.72} V {h} H {w * 0.28} V {h * 0.88} H {w * 0.42} V {h * 0.75} H 0 Z' },
    decorations: [{ path: rect('w * 0.06', 'h * 0.08', 'w * 0.94', 'h * 0.67') }],
    ...below,
    defaultSize: { w: 72, h: 60 },
    describe: 'A desktop computer or workstation with its monitor.',
    keywords: ['desktop', 'computer', 'workstation', 'pc', 'monitor', 'display'],
  }),
  device('laptop', 'computers', {
    // the open lid above a wider base; the hinge and the touchpad are decorations
    outline: { path: 'M {w * 0.1} 0 H {w * 0.9} V {h * 0.82} H {w} V {h} H 0 V {h * 0.82} H {w * 0.1} Z' },
    decorations: [
      { path: rect('w * 0.16', 'h * 0.1', 'w * 0.84', 'h * 0.74') },
      { path: 'M {w * 0.1} {h * 0.82} H {w * 0.9}' },
      { path: 'M {w * 0.42} {h * 0.91} H {w * 0.58}' },
    ],
    anchors: compass(0, 0.91, 0, 1),
    ...below,
    defaultSize: { w: 80, h: 52 },
    describe: 'A laptop or notebook computer.',
    keywords: ['laptop', 'notebook', 'computer', 'portable', 'client'],
  }),
  device('phone', 'mobile', {
    outline: { path: rounded(handheld) },
    decorations: [
      { path: rect('w * 0.1', 'h * 0.12', 'w * 0.9', 'h * 0.86') },
      { path: 'M {w * 0.4} {h * 0.06} H {w * 0.6}' },
      { path: 'M {w * 0.38} {h * 0.93} H {w * 0.62}' },
    ],
    ...below,
    defaultSize: { w: 36, h: 64 },
    describe: 'A smartphone or other handheld mobile device.',
    keywords: ['phone', 'smartphone', 'mobile', 'handset', 'cell', 'client'],
  }),
  device('tablet', 'mobile', {
    outline: { path: rounded(handheld) },
    decorations: [{ path: rect('w * 0.08', 'h * 0.08', 'w * 0.92', 'h * 0.88') }, { path: 'M {w * 0.42} {h * 0.94} H {w * 0.58}' }],
    ...below,
    defaultSize: { w: 56, h: 72 },
    describe: 'A tablet computer.',
    keywords: ['tablet', 'pad', 'mobile', 'touch', 'client'],
  }),
  device('watch', 'mobile', {
    // the strap above and below a wider case; a dial with two hands
    outline: {
      path: 'M {w * 0.25} 0 H {w * 0.75} V {h * 0.2} H {w * 0.9} V {h * 0.8} H {w * 0.75} V {h} H {w * 0.25} V {h * 0.8} H {w * 0.1} V {h * 0.2} H {w * 0.25} Z',
    },
    decorations: [
      { path: circle('w/2', 'h/2', 'min(w * 0.3, h * 0.24)') },
      { path: 'M {w/2} {h/2} V {h/2 - min(w * 0.3, h * 0.24) * 0.6}' },
      { path: 'M {w/2} {h/2} H {w/2 + min(w * 0.3, h * 0.24) * 0.45}' },
    ],
    anchors: compass(0, 0.5, 0.1, 1),
    ...below,
    defaultSize: { w: 36, h: 56 },
    describe: 'A smartwatch or other wearable.',
    keywords: ['watch', 'smartwatch', 'wearable', 'fitness tracker'],
  }),
  device('printer', 'peripherals', {
    // paper standing in the feed above the body, the output tray below it
    outline: {
      path: 'M {w * 0.25} 0 H {w * 0.75} V {h * 0.3} H {w} V {h * 0.8} H {w * 0.8} V {h} H {w * 0.2} V {h * 0.8} H 0 V {h * 0.3} H {w * 0.25} Z',
    },
    decorations: [
      { path: 'M {w * 0.2} {h * 0.65} H {w * 0.8}' },
      { path: 'M {w * 0.8} {h * 0.42} H {w * 0.88}' },
      { path: 'M {w * 0.33} {h * 0.9} H {w * 0.67}' },
    ],
    ...below,
    defaultSize: { w: 64, h: 52 },
    describe: 'A printer or multifunction device.',
    keywords: ['printer', 'print', 'copier', 'multifunction', 'peripheral'],
  }),
  device('keyboard', 'peripherals', {
    outline: { path: rounded('min(w, h) * 0.12') },
    decorations: [...keys, { path: 'M {w * 0.29} {h * 0.72} H {w * 0.71}' }],
    ...below,
    defaultSize: { w: 88, h: 32 },
    describe: 'A keyboard: text and command input.',
    keywords: ['keyboard', 'input', 'typing', 'peripheral'],
  }),
  device('mouse', 'peripherals', {
    outline: { path: rounded('min(w, h) * 0.45') },
    decorations: [{ path: 'M 0 {h * 0.4} H {w}' }, { path: 'M {w/2} 0 V {h * 0.4}' }],
    ...below,
    defaultSize: { w: 32, h: 48 },
    describe: 'A mouse or other pointing device.',
    keywords: ['mouse', 'pointer', 'pointing device', 'input', 'peripheral'],
  }),
  device('camera', 'peripherals', {
    // a body with a viewfinder bump on top and a round lens
    outline: { path: 'M 0 {h * 0.2} H {w * 0.3} V 0 H {w * 0.6} V {h * 0.2} H {w} V {h} H 0 Z' },
    decorations: [{ path: circle('w/2', 'h * 0.6', 'min(w * 0.22, h * 0.28)') }, { path: 'M {w * 0.78} {h * 0.34} H {w * 0.88}' }],
    ...below,
    defaultSize: { w: 64, h: 48 },
    describe: 'A camera: still, video, webcam or security camera.',
    keywords: ['camera', 'webcam', 'cctv', 'video', 'photo', 'capture'],
  }),
  device('usb-drive', 'peripherals', {
    // the plug above the stick, with its two contacts
    outline: { path: 'M {w * 0.3} 0 H {w * 0.7} V {h * 0.25} H {w} V {h} H 0 V {h * 0.25} H {w * 0.3} Z' },
    decorations: [{ path: rect('w * 0.38', 'h * 0.08', 'w * 0.46', 'h * 0.16') }, { path: rect('w * 0.54', 'h * 0.08', 'w * 0.62', 'h * 0.16') }],
    ...below,
    defaultSize: { w: 28, h: 60 },
    describe: 'A USB stick or other removable storage.',
    keywords: ['usb', 'flash drive', 'thumb drive', 'removable', 'storage'],
  }),
  device('tv', 'media', {
    // a wide screen on two feet
    outline: {
      path: 'M 0 0 H {w} V {h * 0.85} H {w * 0.8} V {h} H {w * 0.7} V {h * 0.85} H {w * 0.3} V {h} H {w * 0.2} V {h * 0.85} H 0 Z',
    },
    decorations: [{ path: rect('w * 0.05', 'h * 0.08', 'w * 0.95', 'h * 0.77') }],
    anchors: compass(0, 0.42, 0, 0.85),
    ...below,
    defaultSize: { w: 88, h: 56 },
    describe: 'A television, display screen or digital signage.',
    keywords: ['tv', 'television', 'screen', 'display', 'signage', 'media'],
  }),
  device('speaker', 'media', {
    outline: { path: rounded('min(w, h) * 0.1') },
    decorations: [{ path: circle('w/2', 'h * 0.64', 'min(w * 0.32, h * 0.22)') }, { path: circle('w/2', 'h * 0.24', 'min(w * 0.12, h * 0.09)') }],
    ...below,
    defaultSize: { w: 44, h: 64 },
    describe: 'A loudspeaker or smart speaker.',
    keywords: ['speaker', 'audio', 'sound', 'smart speaker', 'media'],
  }),
  device('sensor', 'iot', {
    // a round sensor with a centre element and a reading wave on either side
    outline: { path: ellipse('w/2', 'h/2', 'w/2', 'h/2') },
    decorations: [
      { path: circle('w/2', 'h/2', 'min(w, h) * 0.1') },
      { path: 'M {w * 0.3} {h * 0.32} A {w * 0.25} {h * 0.25} 0 0 0 {w * 0.3} {h * 0.68}' },
      { path: 'M {w * 0.7} {h * 0.32} A {w * 0.25} {h * 0.25} 0 0 1 {w * 0.7} {h * 0.68}' },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A sensor: measures and reports a physical quantity.',
    keywords: ['sensor', 'iot', 'probe', 'detector', 'telemetry', 'measurement'],
  }),
  device('iot-device', 'iot', {
    // a box with an antenna stub and two status lights
    outline: { path: 'M 0 {h * 0.25} H {w * 0.7} V 0 H {w * 0.78} V {h * 0.25} H {w} V {h} H 0 Z' },
    decorations: [{ path: 'M {w * 0.15} {h * 0.62} H {w * 0.25}' }, { path: 'M {w * 0.35} {h * 0.62} H {w * 0.45}' }],
    anchors: compass(0.25, 0.62, 0, 1),
    ...below,
    defaultSize: { w: 64, h: 48 },
    describe: 'A connected device, edge node or IoT gateway.',
    keywords: ['iot', 'device', 'edge', 'gateway', 'embedded', 'connected'],
  }),
  device('thermostat', 'iot', {
    outline: { path: ellipse('w/2', 'h/2', 'w/2', 'h/2') },
    decorations: [{ path: circle('w/2', 'h/2', 'min(w, h) * 0.32') }, { path: 'M {w/2} {h * 0.18} V {h * 0.32}' }],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A thermostat or other smart-home controller.',
    keywords: ['thermostat', 'smart home', 'controller', 'climate', 'iot'],
  }),
];
