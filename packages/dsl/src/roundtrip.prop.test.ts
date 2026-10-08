// FR-DSL-002 round trip (06-ai-authoring.md §3.1): for generated FluxScript, compile(decompile(compile(src))) is compile(src), byte for
// byte once serialized. Sources are written as JSON (a YAML flow document), so their kept sections are flow text the decompiler writes back.
import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { decompile } from './decompile/decompile.js';
import { registries } from './decompile/registries.fixture.js';
import { EDGE_OPS } from './parse/edge.js';

type J = { [key: string]: unknown };

const TEXTS = [
  'API',
  'Orders DB',
  'a: b',
  '#tag',
  '123',
  'true',
  'null',
  'charge()',
  'two\nlines',
  ' padded ',
  'say "hi"',
  "it's",
  '{curly}',
  '[x]',
  'x, y',
  '- dash',
  'ünïcode ✓',
  'color.primary',
  '',
  'a\r\nb',
];
const SHAPES = ['basic:rect', 'flowchart:rect', 'rounded-rect', 'database', 'flowchart:queue'];
const STYLES: readonly unknown[] = [
  'dashed',
  'dotted',
  'solid',
  { fill: 'color.primary' },
  { fill: '#ff0000', 'stroke.width': 2 },
  { stroke: 'color.text', opacity: 0.5 },
  { variant: 'card' },
];

const text = fc.constantFrom(...TEXTS);
const opt = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
const pin = fc.record({
  x: fc.integer({ min: -100, max: 2000 }),
  y: fc.constantFrom(0, 12.5, 400),
  w: opt(fc.integer({ min: 1, max: 400 })),
  h: opt(fc.integer({ min: 1, max: 300 })),
});

/** A node's fields: a shape with any of text, label and alt, or text alone. */
const node = fc.record({
  shape: opt(fc.constantFrom(...SHAPES)),
  text: opt(text),
  label: opt(text),
  alt: opt(text),
  tone: opt(fc.constantFrom('accent', 'muted')),
  style: opt(fc.constantFrom(...STYLES)),
  pin: opt(pin),
  icon: opt(fc.constantFrom('lucide:globe', 'lucide:db')),
});

const edge = fc.record({
  from: fc.nat(),
  to: fc.nat(),
  op: fc.constantFrom(...EDGE_OPS),
  fromAnchor: opt(fc.constantFrom('n', 'e', 's', 'w', 'out-1')),
  toAnchor: opt(fc.constantFrom('n', 'w')),
  label: opt(text),
  route: opt(fc.constantFrom('straight', 'curved', 'orthogonal')),
  style: opt(fc.constantFrom(...STYLES.filter((s) => typeof s === 'string' || !('variant' in (s as J))))),
  flow: opt(fc.constant('dots')),
  objectForm: fc.boolean(),
});

const screen = fc.record({
  title: opt(text),
  layout: opt(fc.constantFrom({ type: 'stack' }, { type: 'stack', gap: 12, direction: 'right' })),
  background: opt(fc.constantFrom('#ffffff', 'color.surface')),
  notes: opt(text),
  nodes: fc.array(node, { maxLength: 6 }),
  groups: fc.array(fc.record({ label: opt(text), members: fc.array(fc.nat(), { maxLength: 3 }), style: opt(fc.constantFrom(...STYLES)) }), { maxLength: 2 }),
  edges: fc.array(edge, { maxLength: 6 }),
  steps: opt(fc.constant([{ show: ['x'] }, { effect: 'fade' }])),
  archetype: fc.boolean(),
});

const file = fc.record({
  title: text,
  theme: fc.constantFrom<unknown>(undefined, 'light', 'ocean', { preset: 'ocean', overrides: { 'color.primary': '#123456', 'space.md': 20 }, mode: 'auto' }),
  vars: opt(fc.constant({ brand: 'Acme' })),
  screens: fc.array(screen, { minLength: 1, maxLength: 3 }),
  indent: fc.constantFrom(0, 2),
});

type Gen = typeof file extends fc.Arbitrary<infer T> ? T : never;
type GenScreen = Gen['screens'][number];

const defined = (o: J): J => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** A node's FluxScript: a text node has no shape, so it needs text or a label. */
function nodeJson(n: GenScreen['nodes'][number]): J {
  const content = n.shape !== undefined || n.text !== undefined || n.label !== undefined ? {} : { label: 'X' };
  return defined({
    shape: n.shape,
    text: n.text,
    label: n.label,
    alt: n.alt,
    tone: n.tone,
    style: n.style,
    pin: n.pin && defined(n.pin),
    icon: n.icon,
    ...content,
  });
}

function edgeJson(e: GenScreen['edges'][number], ends: readonly string[]): unknown {
  const at = (i: number, anchor: string | undefined) => `${ends[i % ends.length]}${anchor ? `.${anchor}` : ''}`;
  const [from, to] = [at(e.from, e.fromAnchor), at(e.to, e.toAnchor)];
  const details = defined({ label: e.label, route: e.route, style: e.style, flow: e.flow });
  if (e.objectForm) return { from, to, op: e.op, ...details };
  const key = `${from} ${e.op} ${to}`;
  if (Object.keys(details).length === 0) return key;
  return { [key]: Object.keys(details).length === 1 && details['label'] !== undefined ? details['label'] : details };
}

function screenJson(s: GenScreen, k: number): J {
  const id = `s${k}-screen`;
  if (s.archetype) return { id, kind: 'title', title: 'Archetype' };
  const slugs = s.nodes.map((_, i) => `n${k}-${i}`);
  const taken = new Set<number>();
  const groups = s.groups.map((g, i) => {
    const members = [...new Set(g.members.map((m) => m % Math.max(1, slugs.length)))].filter((m) => m < slugs.length && !taken.has(m));
    for (const m of members) taken.add(m);
    return [`g${k}-${i}`, defined({ label: g.label, contains: members.map((m) => slugs[m]), style: g.style })] as const;
  });
  const ends = [...slugs, ...groups.map(([slug]) => slug)];
  return defined({
    id,
    title: s.title,
    layout: s.layout,
    background: s.background,
    nodes: s.nodes.length ? Object.fromEntries(s.nodes.map((n, i) => [slugs[i], nodeJson(n)])) : undefined,
    groups: groups.length ? Object.fromEntries(groups) : undefined,
    edges: ends.length && s.edges.length ? s.edges.map((e) => edgeJson(e, ends)) : undefined,
    notes: s.notes,
    steps: s.steps,
  });
}

const source = (g: Gen): string =>
  JSON.stringify(
    defined({ flux: 1, title: g.title, theme: g.theme, uses: ['basic', 'flowchart'], vars: g.vars, screens: g.screens.map(screenJson) }),
    null,
    g.indent,
  );

const errors = (text: string) => {
  const r = compile(text, { registries: registries() });
  return { doc: r.doc as DocumentFile, errors: r.diagnostics.filter((d) => d.severity === 'error') };
};

describe('decompile round trip', () => {
  it('FR-DSL-002: compile(decompile(compile(src))) equals compile(src) for generated sources', () => {
    fc.assert(
      fc.property(file, (g) => {
        const first = errors(source(g));
        // the generator writes only what compiles
        expect(first.errors).toEqual([]);
        const { text, kept } = decompile(first.doc, { registries: registries() });
        expect(kept).toBe(0);
        const again = errors(text);
        expect(again.errors).toEqual([]);
        expect(serializeDocument(again.doc)).toBe(serializeDocument(first.doc));
        expect(decompile(again.doc, { registries: registries() }).text).toBe(text);
      }),
      { numRuns: 200, seed: 20261008 },
    );
  });
});
