import { createCoreRegistries, idKeys, type ShapeDef, sha256Hash128, stableId } from '@fluxion/core';
import { type AnyRecord, type RecordId, SCHEMA_VERSION, validate } from '@fluxion/schema';
import { LIGHT_THEME, validateTheme } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { parseFlux } from '../parse/parse.js';
import { CHECKOUT } from '../read/checkout.fixture.js';
import { readFlux } from '../read/read.js';
import { resolveFlux } from '../resolve/resolve.js';
import { type ExpandResult, expandFlux } from './expand.js';

/** Registries with a few shapes (some with a default size) and two themes, as a host would have after registering its packs. */
function registries() {
  const r = createCoreRegistries();
  const sized: { readonly [id: string]: { w: number; h: number } } = { 'basic:rounded-rect': { w: 200, h: 100 }, 'flowchart:database': { w: 120, h: 140 } };
  for (const id of ['basic:rect', 'basic:rounded-rect', 'flowchart:database', 'flowchart:queue', 'icons-lucide:globe', 'effects-core:dot'])
    r.shapeDefs.register(id, { id, ...(sized[id] ? { defaultSize: sized[id] } : {}) } as unknown as ShapeDef, id.split(':')[0] ?? id);
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  r.themes.register('themes-core:ocean', { ...LIGHT_THEME, id: 'themes-core:ocean', name: 'ocean' }, 'themes-core');
  return r;
}

/** parse → read → resolve → expand; the earlier stages must be clean but for `FLX_DSL_NOT_YET`. */
function expand(text: string, salt = ''): ExpandResult {
  const parsed = parseFlux(text);
  if (!parsed.root) throw new Error(JSON.stringify(parsed.diagnostics));
  const read = readFlux(parsed.root, text);
  if (!read.ast) throw new Error(JSON.stringify(read.diagnostics));
  const reg = registries();
  const resolved = resolveFlux(read.ast, reg);
  const errors = [...read.diagnostics, ...resolved.diagnostics].filter((d) => d.code !== 'FLX_DSL_NOT_YET');
  if (errors.length) throw new Error(JSON.stringify(errors));
  return expandFlux(read.ast, resolved.resolution, { salt, registries: reg });
}

const doc = (body: string, head = 'uses: [basic, flowchart]\n') => `flux: 1\ntitle: Checkout\n${head}screens:\n${body}`;
const id = (key: string, salt = '') => stableId(sha256Hash128, salt, key);
const rec = (r: ExpandResult, key: string) => r.records[id(key)] as AnyRecord & { readonly [k: string]: unknown };
const problems = (r: ExpandResult) => validate({ schemaVersion: SCHEMA_VERSION, records: r.records }).filter((d) => d.severity === 'error');
const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('expand and style stages (FR-DSL-002, ADR-0030, ADR-0031)', () => {
  it('FR-DSL-002: meta compiles to a document record with its title, theme and source (salt, deferred sections)', () => {
    const r = expand(doc('  - id: a\n', 'uses: [basic]\nvars: { brand: Acme }\n'), 's1');
    expect(problems(r)).toEqual([]);
    expect(r.records[id('document', 's1')]).toEqual({
      id: id('document', 's1'),
      type: 'document',
      title: 'Checkout',
      themeId: id('theme:light', 's1'),
      source: { flux: 1, salt: 's1', deferred: { '/vars': expect.stringContaining('brand: Acme') } },
    });
  });

  it('FR-DSL-002: the theme compiles to a theme record named by the theme, with its token overrides applied', () => {
    const r = expand(doc('  - id: a\n', 'theme: { preset: ocean, overrides: { color.primary: "#000000" } }\nuses: [basic]\n'));
    expect(problems(r)).toEqual([]);
    const th = rec(r, 'theme:ocean') as AnyRecord & { tokens: { color: { primary: unknown; surface: unknown } } };
    expect(th).toMatchObject({ type: 'theme', name: 'ocean' });
    expect(th.tokens.color.primary).toMatchObject({ $type: 'color', $value: '#000000' });
    // untouched tokens are the theme's own, and the theme itself is not changed
    const light = LIGHT_THEME.tokens['color'] as unknown as { primary: { $value: string }; surface: unknown };
    expect(th.tokens.color.surface).toEqual(light.surface);
    expect(light.primary.$value).not.toBe('#000000');
    expect(rec(r, 'document')['themeId']).toBe(id('theme:ocean'));
  });

  it('FR-DSL-002: an override is written as its token type wants it; one the type refuses is a diagnostic at its key, and the theme stays valid', () => {
    const r = expand(
      doc(
        '  - id: a\n',
        'theme:\n  preset: light\n  overrides:\n    font.size.sm: 13\n    font.size.md: 15px\n    font.size.lg: big\n    color.primary: 12\nuses: [basic]\n',
      ),
    );
    expect(problems(r)).toEqual([]);
    const th = rec(r, 'theme:light') as AnyRecord & { tokens: unknown };
    expect(validateTheme(th)).toEqual([]);
    const size = (th.tokens as { font: { size: { [k: string]: { $value: unknown } } } }).font.size;
    expect(size['sm']?.$value).toEqual({ value: 13, unit: 'px' });
    expect(size['md']?.$value).toEqual({ value: 15, unit: 'px' });
    expect(r.diagnostics.map((d) => [d.code, d.path, d.source?.line])).toEqual([
      ['FLX_SCHEMA_INVALID', '/theme/overrides/font.size.lg', 8],
      ['FLX_SCHEMA_INVALID', '/theme/overrides/color.primary', 9],
    ]);
  });

  it('FR-DSL-002: screens compile in order with their title, layout intent, background and notes', () => {
    const r = expand(
      doc(`  - id: one
    title: Architecture
    layout: { type: layered, direction: right }
    background: color.surface
    notes: Start with the gateway.
  - id: two
    background: "#ffffff"
`),
    );
    expect(problems(r)).toEqual([]);
    const one = rec(r, 'screen:one');
    const two = rec(r, 'screen:two');
    expect(one).toMatchObject({
      type: 'screen',
      meta: { slug: 'one' },
      name: 'Architecture',
      layout: { type: 'layered', options: { direction: 'right' } },
      background: '{color.surface}',
      notes: para('Start with the gateway.'),
    });
    expect(two).toMatchObject({ type: 'screen', background: '#ffffff' });
    expect(two['layout']).toBeUndefined();
    expect(String(one['index']) < String(two['index'])).toBe(true);
  });

  it('FR-DSL-002: nodes compile to shape and text elements: slug, label as rich text, tone as variant, token styles, pins, alt', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      api: { shape: rounded-rect, label: API Gateway, tone: accent, style: { fill: color.primary, stroke: color.text, stroke.width: stroke.thick, opacity: 0.5 } }
      db: { shape: flowchart:database, label: Orders DB, alt: Orders database, pin: { x: 100, y: 200, w: 300 } }
      q: { shape: flowchart:queue, style: dotted }
      note: { text: "Hello\\nworld" }
`),
    );
    expect(problems(r)).toEqual([]);
    expect(rec(r, 'node:api')).toMatchObject({
      type: 'element',
      kind: 'shape',
      defId: 'basic:rounded-rect',
      screenId: id('screen:a'),
      semantic: { slug: 'api', label: 'API Gateway' },
      text: para('API Gateway'),
      style: { fill: '{color.primary}', stroke: { color: '{color.text}', width: '{stroke.thick}' }, opacity: 0.5, variant: 'accent' },
      placement: 'auto',
      transform: { x: 0, y: 0, w: 200, h: 100 },
    });
    // a pin keeps its box, the shape's default size filling what it leaves out; alt is the accessible name
    expect(rec(r, 'node:db')).toMatchObject({
      semantic: { slug: 'db', label: 'Orders database' },
      text: para('Orders DB'),
      placement: 'pinned',
      transform: { x: 100, y: 200, w: 300, h: 140 },
    });
    // a shape without a default size takes the fixed one; a stroke preset is a dash
    expect(rec(r, 'node:q')).toMatchObject({ transform: { w: 160, h: 80 }, style: { stroke: { dash: [2, 4] } } });
    expect(rec(r, 'node:q')['text']).toBeUndefined();
    expect(rec(r, 'node:note')).toMatchObject({
      kind: 'text',
      semantic: { slug: 'note' },
      text: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
        ],
      },
    });
    // siblings have distinct, ordered indices
    const indices = ['node:api', 'node:db', 'node:q', 'node:note'].map((k) => String(rec(r, k)['index']));
    expect([...indices].sort()).toEqual(indices);
    expect(new Set(indices).size).toBe(4);
  });

  it('FR-DSL-002: groups compile to group elements holding their members, with label, layout and style', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      api: { shape: rect, label: API }
      db: { shape: rect, label: DB }
      web: { shape: rect, label: Web }
    groups:
      backend: { label: Backend, contains: [api, db], style: dashed, layout: { type: stack, gap: 24 } }
`),
    );
    expect(problems(r)).toEqual([]);
    const g = rec(r, 'node:backend');
    expect(g).toMatchObject({
      kind: 'group',
      semantic: { slug: 'backend', label: 'Backend' },
      text: para('Backend'),
      style: { stroke: { dash: [8, 4] } },
      layout: { type: 'stack', options: { gap: 24 } },
      placement: 'auto',
    });
    expect(g['parentId']).toBeUndefined();
    expect(rec(r, 'node:api')['parentId']).toBe(id('node:backend'));
    expect(rec(r, 'node:db')['parentId']).toBe(id('node:backend'));
    expect(rec(r, 'node:web')['parentId']).toBeUndefined();
  });

  it('FR-DSL-002: a member in two groups stays in the first, with a diagnostic', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      api: { shape: rect }
    groups:
      one: { contains: [api] }
      two: { contains: [api] }
`),
    );
    expect(rec(r, 'node:api')['parentId']).toBe(id('node:one'));
    expect(r.diagnostics.map((d) => [d.code, d.path, d.source?.line])).toEqual([['FLX_PARENT_INVALID', '/screens/0/groups/two/contains/0', 10]]);
  });

  it('FR-DSL-002: groups inside each other stop at the first one that would close a cycle, with a diagnostic', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      x: { shape: rect }
    groups:
      g1: { contains: [g2] }
      g2: { contains: [g1, x] }
`),
    );
    expect(rec(r, 'node:g2')['parentId']).toBe(id('node:g1'));
    expect(rec(r, 'node:g1')['parentId']).toBeUndefined();
    expect(rec(r, 'node:x')['parentId']).toBe(id('node:g2'));
    expect(problems(r)).toEqual([]);
    expect(r.diagnostics.map((d) => [d.code, d.path])).toEqual([['FLX_PARENT_INVALID', '/screens/0/groups/g2/contains/0']]);
  });

  it('FR-DSL-002: edges compile to connectors and two bindings: markers and dashing by op, anchors, label, route, style', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      web: { shape: rect }
      api: { shape: rect }
    edges:
      - web -> api: HTTPS
      - web <- api
      - web.e <-> api.w: { route: orthogonal }
      - web -- api.top
      - web ~> api: { label: event, style: { stroke: color.accent-1 } }
`),
    );
    expect(problems(r)).toEqual([]);
    const edge = (op: string) => rec(r, idKeys.edge({ screen: 'a', from: 'web', op, to: 'api' }));
    expect(edge('->')).toMatchObject({
      kind: 'connector',
      screenId: id('screen:a'),
      route: { type: 'straight' },
      markers: { start: 'none', end: 'arrow' },
      labels: [{ text: para('HTTPS'), position: 0.5 }],
    });
    expect(edge('<-')).toMatchObject({ markers: { start: 'arrow', end: 'none' } });
    expect(edge('<->')).toMatchObject({ markers: { start: 'arrow', end: 'arrow' }, route: { type: 'orthogonal' } });
    expect(edge('--')).toMatchObject({ markers: { start: 'none', end: 'none' } });
    expect(edge('~>')).toMatchObject({ markers: { start: 'none', end: 'arrow' }, style: { stroke: { color: '{color.accent-1}', dash: [8, 4] } } });
    expect(edge('->')['style']).toBeUndefined();
    const bindings = Object.values(r.records).filter((x) => x.type === 'binding') as unknown as {
      connectorId: string;
      end: string;
      elementId: string;
      anchor: unknown;
    }[];
    const of = (op: string) => bindings.filter((b) => b.connectorId === edge(op).id).sort((x, y) => x.end.localeCompare(y.end));
    expect(of('->')).toMatchObject([
      { end: 'source', elementId: id('node:web'), anchor: { kind: 'auto' } },
      { end: 'target', elementId: id('node:api'), anchor: { kind: 'auto' } },
    ]);
    expect(of('<->').map((b) => b.anchor)).toEqual([
      { kind: 'side', side: 'e' },
      { kind: 'side', side: 'w' },
    ]);
    expect(of('--').map((b) => b.anchor)).toEqual([{ kind: 'auto' }, { kind: 'named', name: 'top' }]);
  });

  it('FR-DSL-002: the n-th repeat of the same edge on a screen gets the key suffix :n', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      web: { shape: rect }
      api: { shape: rect }
    edges:
      - web -> api: first
      - web -> api: second
      - web -> api: third
`),
    );
    expect(problems(r)).toEqual([]);
    const key = (n?: number) => idKeys.edge({ screen: 'a', from: 'web', op: '->', to: 'api', ...(n ? { n } : {}) });
    expect(rec(r, key())).toMatchObject({ labels: [{ text: para('first') }] });
    expect(rec(r, key(2))).toMatchObject({ labels: [{ text: para('second') }] });
    expect(rec(r, key(3))).toMatchObject({ labels: [{ text: para('third') }] });
    expect(key(2)).toBe('edge:a:web:->:api:2');
  });

  it('FR-DSL-002: a node whose only content keys are deferred emits no record; its source stays in document.source', () => {
    const r = expand(
      doc(`  - id: a
    nodes:
      web: { shape: rect }
      sla: { component: basic:stat, props: { value: 400ms } }
`),
    );
    expect(problems(r)).toEqual([]);
    expect(r.records[id('node:sla')]).toBeUndefined();
    expect(Object.values(r.records).filter((x) => x.type === 'element')).toHaveLength(1);
    expect(Object.keys((rec(r, 'document')['source'] as { deferred: object }).deferred)).toEqual(['/screens/a/nodes/sla']);
  });

  it('FR-DSL-002: ids are the stable ids of their keys, and the same input twice gives identical records and source map', () => {
    const text = doc(`  - id: a
    nodes:
      web: { shape: rect }
    edges:
      - web -> web
`);
    const a = expand(text, 'salt');
    const b = expand(text, 'salt');
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
    expect([...a.sourceMap]).toEqual([...b.sourceMap]);
    const keys = ['document', 'theme:light', 'screen:a', 'node:web', 'edge:a:web:->:web'];
    for (const k of keys) expect(a.records[id(k, 'salt')]?.id).toBe(id(k, 'salt'));
    // every record but the bindings has a key; every record maps to its source
    expect(Object.values(a.records).filter((x) => x.type !== 'binding')).toHaveLength(keys.length);
    expect(Object.keys(a.records).every((k) => k === id('document', 'salt') || k === id('theme:light', 'salt') || a.sourceMap.has(k as RecordId))).toBe(true);
    // another salt, other ids
    expect(expand(text, 'other').records[id('node:web', 'salt')]).toBeUndefined();
  });

  it('FR-DSL-002: the checkout example compiles end to end (parse, read, resolve, expand) to a document that validates', () => {
    const r = expand(CHECKOUT);
    expect(problems(r)).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    const elements = Object.values(r.records).filter((x) => x.type === 'element') as unknown as { semantic?: { slug?: string } }[];
    // five nodes, one group and four edges; sla (a component) is kept in document.source
    expect(elements).toHaveLength(10);
    expect(
      elements
        .map((e) => e.semantic?.slug)
        .filter(Boolean)
        .sort(),
    ).toEqual(['api', 'backend', 'db', 'pay', 'queue', 'web']);
    expect(Object.values(r.records).filter((x) => x.type === 'screen')).toHaveLength(4);
    expect(Object.values(r.records).filter((x) => x.type === 'binding')).toHaveLength(8);
    expect(rec(r, 'node:api')).toMatchObject({ style: { variant: 'accent' } });
    expect(rec(r, 'node:queue')).toMatchObject({ placement: 'pinned', transform: { x: 1500, y: 820 } });
    expect(rec(r, 'node:backend')).toMatchObject({ kind: 'group', style: { stroke: { dash: [8, 4] } } });
    const deferred = (rec(r, 'document')['source'] as { deferred: { [p: string]: string } }).deferred;
    expect(Object.keys(deferred)).toContain('/screens/arch/nodes/sla');
    expect(Object.keys(deferred)).toContain('/screens/arch/steps');
  });
});
