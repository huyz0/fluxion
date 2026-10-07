import { describe, expect, it } from 'vitest';
import { parseFlux } from '../parse/parse.js';
import { CHECKOUT } from './checkout.fixture.js';
import { readFlux } from './read.js';

const read = (text: string) => {
  const parsed = parseFlux(text);
  if (!parsed.root) throw new Error(JSON.stringify(parsed.diagnostics));
  return readFlux(parsed.root, text);
};
const codes = (text: string) => read(text).diagnostics.map((d) => `${d.code} ${d.path}`);

const SOURCE = `flux: 1
title: Checkout
theme: { preset: ocean, overrides: { color.accent: "#7C5CFF" } }
uses: [basic, flowchart]
screens:
  - id: arch
    title: Architecture
    layout: { type: stack, gap: 24 }
    background: surface
    nodes:
      web: { shape: rounded-rect, label: Web, tone: accent, alt: The web app }
      api: { shape: rounded-rect, label: API, style: { fill: color.primary }, pin: { x: 100, y: 200, w: 240 } }
      note: { text: Hello }
    groups:
      backend: { label: Backend, contains: [api], style: dashed, layout: { type: stack } }
    edges:
      - web -> api
      - web.e -> api.w: HTTPS
      - api ~> web: { label: event, route: orthogonal, style: dashed }
      - { from: api, to: web, op: <->, label: sync }
    notes: Say hello.
`;

describe('read stage (FR-DSL-001, FR-DSL-002, ADR-0030)', () => {
  it('FR-DSL-002: meta, theme, screens, nodes, groups and edges read into a typed tree with their places', () => {
    const { ast, diagnostics } = read(SOURCE);
    expect(diagnostics).toEqual([]);
    expect(ast?.title?.value).toBe('Checkout');
    expect(ast?.theme).toMatchObject({ name: { value: 'ocean' }, overrides: { 'color.accent': '#7C5CFF' } });
    expect(ast?.uses.map((u) => u.value)).toEqual(['basic', 'flowchart']);
    const [s] = ast?.screens ?? [];
    expect(s).toMatchObject({
      id: { value: 'arch', range: { line: 6 } },
      title: { value: 'Architecture' },
      background: { value: 'surface' },
      notes: { value: 'Say hello.' },
    });
    expect(s?.layout).toMatchObject({ type: { value: 'stack' }, options: { gap: 24 } });
    expect(s?.nodes.map((n) => n.slug.value)).toEqual(['web', 'api', 'note']);
    expect(s?.nodes[0]).toMatchObject({ shape: { value: 'rounded-rect' }, label: { value: 'Web' }, tone: { value: 'accent' }, alt: { value: 'The web app' } });
    expect(s?.nodes[1]).toMatchObject({ style: { value: { fill: 'color.primary' } }, pin: { value: { x: 100, y: 200, w: 240 } } });
    expect(s?.nodes[2]).toMatchObject({ text: { value: 'Hello' } });
    expect(s?.groups[0]).toMatchObject({
      slug: { value: 'backend' },
      label: { value: 'Backend' },
      style: { value: 'dashed' },
      layout: { type: { value: 'stack' } },
    });
    expect(s?.groups[0]?.contains.map((c) => c.value)).toEqual(['api']);
    expect(
      s?.edges.map(
        (e) =>
          `${e.edge.from.slug}${e.edge.from.anchor ? `.${e.edge.from.anchor}` : ''} ${e.edge.op} ${e.edge.to.slug}${e.edge.to.anchor ? `.${e.edge.to.anchor}` : ''}`,
      ),
    ).toEqual(['web -> api', 'web.e -> api.w', 'api ~> web', 'api <-> web']);
    expect(s?.edges[1]?.label?.value).toBe('HTTPS');
    expect(s?.edges[2]).toMatchObject({ label: { value: 'event' }, route: { value: 'orthogonal' }, style: { value: 'dashed' } });
    expect(s?.edges[3]?.label?.value).toBe('sync');
    expect(ast?.deferred).toEqual({});
  });

  it('FR-DSL-001: the documented checkout example reads with only FLX_DSL_NOT_YET warnings, its deferred sections kept by pointer', () => {
    const { ast, diagnostics } = read(CHECKOUT);
    expect(diagnostics.filter((d) => d.code !== 'FLX_DSL_NOT_YET')).toEqual([]);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(Object.keys(ast?.deferred ?? {}).sort()).toEqual(
      [
        '/screens/arch/edges/3/flow',
        '/screens/arch/interactions',
        '/screens/arch/nodes/pay/badge',
        '/screens/arch/nodes/sla',
        '/screens/arch/nodes/web/icon',
        '/screens/arch/steps',
        '/screens/data-model/mermaid',
        '/screens/intro/kind',
        '/screens/pay-detail/kind',
        '/theme/accent',
        '/theme/mode',
      ].sort(),
    );
    // a kept section is its source text, so it can be written back
    expect(ast?.deferred['/screens/arch/steps']).toContain('show: [web, api]');
    expect(ast?.screens.map((s) => s.id.value)).toEqual(['intro', 'arch', 'pay-detail', 'data-model']);
    const arch = ast?.screens[1];
    expect(arch?.nodes.map((n) => n.slug.value)).toEqual(['web', 'api', 'pay', 'db', 'queue']);
    expect(arch?.nodes.find((n) => n.slug.value === 'queue')?.pin?.value).toEqual({ x: 1500, y: 820 });
    expect(arch?.edges).toHaveLength(4);
  });

  it('FR-DSL-006: an unknown key is an error at its place with the nearest valid key', () => {
    const r = read('flux: 1\ntitel: X\nscreens:\n  - id: a\n    nodes:\n      n: { shap: rect }\n');
    expect(r.diagnostics.map((d) => [d.code, d.path, d.source?.line, d.hint])).toEqual([
      ['FLX_DSL_UNKNOWN_KEY', '/titel', 2, 'did you mean "title"?'],
      ['FLX_SCHEMA_INVALID', '/title', 1, 'title: How checkout works'],
      ['FLX_DSL_UNKNOWN_KEY', '/screens/0/nodes/n/shap', 6, 'did you mean "shape"?'],
    ]);
    // a node kept whole for its deferred content still has its typos found (M12.39 review F1)
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    nodes:\n      web: { shap: rect, icon: lucide:globe }\n')).toEqual([
      'FLX_DSL_UNKNOWN_KEY /screens/0/nodes/web/shap',
      'FLX_DSL_NOT_YET /screens/0/nodes/web',
    ]);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    zzz: 1\n')).toEqual(['FLX_DSL_UNKNOWN_KEY /screens/0/zzz']);
    // a node with nothing to draw and no kept key is an error, not a kept section
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    nodes:\n      n: { tone: accent }\n')).toEqual(['FLX_SCHEMA_INVALID /screens/0/nodes/n']);
  });

  it('FR-DSL-006: a missing or wrong version, a bad slug or screen id, and malformed values are diagnostics with their pointer', () => {
    expect(codes('title: x\nscreens: []\n')).toEqual(['FLX_DSL_VERSION /flux']);
    expect(codes('flux: 2\nscreens: []\n')).toEqual(['FLX_DSL_VERSION /flux']);
    expect(read('flux: 2\nscreens: []\n').ast).toBeUndefined();
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: Intro\n')).toEqual(['FLX_DSL_BAD_SLUG /screens/0/id']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    nodes:\n      Web: { shape: rect }\n')).toEqual(['FLX_DSL_BAD_SLUG /screens/0/nodes/Web']);
    expect(codes('flux: 1\ntitle: t\nscreens: nope\n')).toEqual(['FLX_SCHEMA_INVALID /screens']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - title: no id\n')).toEqual(['FLX_SCHEMA_INVALID /screens/0/id']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    nodes:\n      n: { shape: rect, pin: { x: 1 } }\n')).toEqual([
      'FLX_SCHEMA_INVALID /screens/0/nodes/n/pin',
    ]);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    nodes:\n      n: { shape: rect, pin: { x: 1, y: a } }\n')).toEqual([
      'FLX_SCHEMA_INVALID /screens/0/nodes/n/pin/y',
    ]);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    edges:\n      - a -> b: { route: zigzag }\n')).toEqual([
      'FLX_SCHEMA_INVALID /screens/0/edges/0/route',
    ]);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    edges: { a: b }\n')).toEqual(['FLX_SCHEMA_INVALID /screens/0/edges']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    layout: { gap: 2 }\n')).toEqual(['FLX_SCHEMA_INVALID /screens/0/layout/type']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    groups:\n      g: { contains: api }\n')).toEqual([
      'FLX_SCHEMA_INVALID /screens/0/groups/g/contains',
    ]);
  });

  it('FR-DSL-006: a missing title and values of the wrong type are reported, never dropped (M12.39 review F2, F3)', () => {
    expect(codes('flux: 1\nscreens: []\n')).toEqual(['FLX_SCHEMA_INVALID /title']);
    expect(codes('flux: 1\ntitle: t\nuses: basic\nscreens: []\n')).toEqual(['FLX_SCHEMA_INVALID /uses']);
    expect(codes('flux: 1\ntitle: t\nuses: [basic, 5]\nscreens: []\n')).toEqual(['FLX_SCHEMA_INVALID /uses/1']);
    expect(codes('flux: 1\ntitle: t\ntheme: { overrides: red }\nscreens: []\n')).toEqual(['FLX_SCHEMA_INVALID /theme/overrides']);
    expect(codes('flux: 1\ntitle: t\ntheme: { overrides: { a: [1] } }\nscreens: []\n')).toEqual(['FLX_SCHEMA_INVALID /theme/overrides/a']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    nodes:\n      n: { shape: rect, style: { fill: [a] } }\n')).toEqual([
      'FLX_SCHEMA_INVALID /screens/0/nodes/n/style/fill',
    ]);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    groups:\n      g: { contains: [api, 5] }\n')).toEqual([
      'FLX_SCHEMA_INVALID /screens/0/groups/g/contains/1',
    ]);
  });

  it('FR-DSL-006: one problem is one diagnostic, and a preset with a name is refused (M12.39 review F2, F3)', () => {
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: [a]\n')).toEqual(['FLX_SCHEMA_INVALID /screens/0/id']);
    expect(codes('flux: 1\ntitle: t\nscreens:\n  - id: a\n    layout: { type: [stack] }\n')).toEqual(['FLX_SCHEMA_INVALID /screens/0/layout/type']);
    expect(codes('flux: 1\ntitle: t\ntheme: { preset: ocean, name: brand }\nscreens: []\n')).toEqual(['FLX_SCHEMA_INVALID /theme/name']);
  });

  it('FR-DSL-001: every construct keeps the place it is written at (M12.39 review F1)', () => {
    const { ast } = read(SOURCE);
    const at = (needle: string, from = 0) => {
      const i = SOURCE.indexOf(needle, from);
      const before = SOURCE.slice(0, i).split('\n');
      return { line: before.length, col: (before.at(-1)?.length ?? 0) + 1 };
    };
    const s = ast?.screens[0];
    // a node and a group are placed at their key, a pin and a style at their value
    expect(s?.nodes[1]?.slug.range).toMatchObject(at('api: {'));
    expect(s?.nodes[1]?.pin?.range).toMatchObject(at('{ x: 100'));
    expect(s?.nodes[1]?.style?.range).toMatchObject(at('{ fill:'));
    expect(s?.nodes[0]?.shape?.range).toMatchObject(at('rounded-rect'));
    expect(s?.groups[0]?.slug.range).toMatchObject(at('backend:'));
    expect(s?.groups[0]?.contains[0]?.range).toMatchObject(at('api]'));
    // a shorthand edge at its key text, an object edge at its mapping
    expect(s?.edges[1]?.range).toMatchObject(at('web.e -> api.w'));
    expect(s?.edges[3]?.range).toMatchObject(at('{ from: api'));
    expect(ast?.uses[1]?.range).toMatchObject(at('flowchart'));
  });

  it('FR-DSL-006: a malformed edge, shorthand or object, is reported at its place', () => {
    const r = read(
      'flux: 1\ntitle: t\nscreens:\n  - id: a\n    edges:\n      - a => b\n      - { from: a, to: B }\n      - { from: a, to: b, wat: 1 }\n      - 5\n',
    );
    expect(r.diagnostics.map((d) => [d.code, d.path, d.source?.line])).toEqual([
      ['FLX_DSL_EDGE_SYNTAX', '/screens/0/edges/0', 6],
      ['FLX_DSL_BAD_SLUG', '/screens/0/edges/1/to', 7],
      ['FLX_DSL_UNKNOWN_KEY', '/screens/0/edges/2/wat', 8],
      ['FLX_DSL_EDGE_SYNTAX', '/screens/0/edges/3', 9],
    ]);
  });
});
