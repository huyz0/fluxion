// People (FR-LIB-007): generic people, groups and roles for journey, org and deployment diagrams, as declarative templates
// drawn for Fluxion (ADR-0016). Each is an avatar: an outline frame holding stroke-only figures and badges, one subpath per
// decoration, with no likeness of a real person (ADR-0050); the label sits below.
import type { ShapeDef } from '@fluxion/sdk';

const person = (id: string, category: string, def: Omit<ShapeDef, 'id' | 'license' | 'category'>): ShapeDef => ({
  id: `people:${id}`,
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
/** The round avatar frame of one person. */
const avatar = { path: ellipse('w/2', 'h/2', 'w/2', 'h/2') };
/** The frame of several people. */
const panel = { path: rounded('min(w, h) * 0.2') };
/** Label below the avatar. */
const below = {
  defaultStyle: { font: { verticalAlign: 'top' } },
  textRegions: [{ name: 'body', x: 0, y: 1, w: 1, h: 0 }],
} as const;

/** Scale of one avatar's figure: the smaller side. */
const m = 'min(w, h)';
/**
 * A figure centred at x = `cx`, `s` across, its shoulders standing on `baseY`: the curve of its shoulders and, `s` * 0.42
 * above, its head. Everything is in `s` units, so the figure keeps its shape at any aspect. Two decorations.
 */
const figure = (cx: string, s: string, baseY: string) => [
  { path: circle(cx, `${baseY} - (${s}) * 0.42`, `${s} * 0.16`) },
  { path: `M {${cx} - (${s}) * 0.28} {${baseY}} A {(${s}) * 0.28} {(${s}) * 0.24} 0 0 1 {${cx} + (${s}) * 0.28} {${baseY}}` },
];
/** A height `k` times the figure scale below (negative: above) the avatar's centre, so a figure keeps its shape at any aspect. */
const y = (k: number) => `h/2 + ${m} * ${k}`;
/** The figure of a single avatar. */
const one = figure('w/2', m, y(0.3));
/** The single figure moved left to make room for a badge at its right. */
const aside = figure(`w/2 - ${m} * 0.08`, m, y(0.3));
/** The figure scale of a pair and of a group of three: each figure's share of the width, at most the height. */
const two = 'min(w * 0.5, h)';
const three = 'min(w / 3, h)';
/** A badge right of the figure, inside the frame: its centre and radius. */
const bx = `w/2 + ${m} * 0.3`;
const by = y(0.04);
const br = `${m} * 0.14`;
const badge = { path: circle(bx, by, br) };

/** The shapes of this pack, in library order. */
export const shapes: readonly ShapeDef[] = [
  person('person', 'individuals', {
    outline: avatar,
    decorations: one,
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A person: a user, customer, employee or other individual.',
    keywords: ['person', 'user', 'individual', 'human', 'customer', 'actor', 'account'],
  }),
  person('person-add', 'individuals', {
    outline: avatar,
    decorations: [
      ...aside,
      badge,
      { path: `M {${bx} - (${br}) * 0.55} {${by}} H {${bx} + (${br}) * 0.55}` },
      { path: `M {${bx}} {${by} - (${br}) * 0.55} V {${by} + (${br}) * 0.55}` },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A person being added: a new user, sign-up or invitation.',
    keywords: ['add user', 'new user', 'sign up', 'invite', 'register', 'onboarding'],
  }),
  person('person-check', 'individuals', {
    outline: avatar,
    decorations: [
      ...aside,
      badge,
      { path: `M {${bx} - (${br}) * 0.5} {${by}} L {${bx} - (${br}) * 0.1} {${by} + (${br}) * 0.4} L {${bx} + (${br}) * 0.55} {${by} - (${br}) * 0.4}` },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A verified person: an authenticated, approved or confirmed user.',
    keywords: ['verified user', 'authenticated', 'approved', 'confirmed', 'trusted', 'login'],
  }),
  person('guest', 'individuals', {
    // dashed: someone without an account
    outline: avatar,
    decorations: one,
    defaultStyle: { stroke: { dash: [4, 3] }, font: { verticalAlign: 'top' } },
    textRegions: below.textRegions,
    defaultSize: { w: 48, h: 48 },
    describe: 'A guest (dashed): an anonymous or not yet registered visitor.',
    keywords: ['guest', 'anonymous', 'visitor', 'unregistered', 'public'],
  }),
  person('pair', 'groups', {
    outline: panel,
    decorations: [...figure('w * 0.32', two, `h/2 + ${two} * 0.29`), ...figure('w * 0.68', two, `h/2 + ${two} * 0.29`)],
    ...below,
    defaultSize: { w: 72, h: 48 },
    describe: 'Two people: a pair, partners or a one-to-one relationship.',
    keywords: ['pair', 'two people', 'partners', 'couple', 'peers', 'relationship'],
  }),
  person('group', 'groups', {
    outline: panel,
    decorations: [
      ...figure('w * 0.2', three, `h/2 + ${three} * 0.32`),
      ...figure('w/2', three, `h/2 + ${three} * 0.26`),
      ...figure('w * 0.8', three, `h/2 + ${three} * 0.32`),
    ],
    ...below,
    defaultSize: { w: 88, h: 48 },
    describe: 'A group of people: a team, department, audience or user base.',
    keywords: ['group', 'team', 'people', 'users', 'department', 'audience', 'community'],
  }),
  person('admin', 'roles', {
    outline: avatar,
    decorations: [
      ...aside,
      {
        path:
          `M {${bx}} {${by} - (${br})} L {${bx} + (${br}) * 0.85} {${by} - (${br}) * 0.6} V {${by} + (${br}) * 0.2} ` +
          `L {${bx}} {${by} + (${br})} L {${bx} - (${br}) * 0.85} {${by} + (${br}) * 0.2} V {${by} - (${br}) * 0.6} Z`,
      },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'An administrator: a person with elevated rights (shield badge).',
    keywords: ['admin', 'administrator', 'operator', 'superuser', 'privileged', 'role'],
  }),
  person('developer', 'roles', {
    // a code mark, </>, on the chest
    outline: avatar,
    decorations: [
      ...one,
      { path: `M {w/2 - ${m} * 0.06} {${y(0.14)}} L {w/2 - ${m} * 0.15} {${y(0.21)}} L {w/2 - ${m} * 0.06} {${y(0.28)}}` },
      { path: `M {w/2 + ${m} * 0.06} {${y(0.14)}} L {w/2 + ${m} * 0.15} {${y(0.21)}} L {w/2 + ${m} * 0.06} {${y(0.28)}}` },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A developer or engineer (code mark).',
    keywords: ['developer', 'engineer', 'programmer', 'coder', 'maintainer', 'role'],
  }),
  person('support', 'roles', {
    // a headset over the head: the band and two ear pads
    outline: avatar,
    decorations: [
      ...one,
      { path: `M {w/2 - ${m} * 0.24} {${y(-0.12)}} A {${m} * 0.24} {${m} * 0.24} 0 0 1 {w/2 + ${m} * 0.24} {${y(-0.12)}}` },
      { path: `M {w/2 - ${m} * 0.24} {${y(-0.16)}} V {${y(-0.04)}}` },
      { path: `M {w/2 + ${m} * 0.24} {${y(-0.16)}} V {${y(-0.04)}}` },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A support agent: help desk, customer service or on-call staff (headset).',
    keywords: ['support', 'help desk', 'agent', 'customer service', 'call center', 'on call', 'role'],
  }),
  person('bot', 'roles', {
    // a square head with an antenna and two eyes: an automated actor
    outline: avatar,
    decorations: [
      { path: `M {w/2 - ${m} * 0.18} {${y(-0.24)}} H {w/2 + ${m} * 0.18} V {${y(0.02)}} H {w/2 - ${m} * 0.18} Z` },
      { path: `M {w/2} {${y(-0.24)}} V {${y(-0.34)}}` },
      { path: `M {w/2 - ${m} * 0.09} {${y(-0.12)}} V {${y(-0.08)}}` },
      { path: `M {w/2 + ${m} * 0.09} {${y(-0.12)}} V {${y(-0.08)}}` },
      one[1] as { readonly path: string },
    ],
    ...below,
    defaultSize: { w: 48, h: 48 },
    describe: 'A bot: an automated actor, service account or AI agent.',
    keywords: ['bot', 'robot', 'automation', 'service account', 'agent', 'ai', 'system actor'],
  }),
];
