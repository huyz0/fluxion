import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { parseFlux } from '../parse/parse.js';
import { CHECKOUT } from '../read/checkout.fixture.js';
import { readFlux } from '../read/read.js';
import { resolveFlux } from './resolve.js';

/** Registries with a few shapes in three packs and two themes, as a host would have after registering its packs. */
function registries() {
  const r = createCoreRegistries();
  for (const id of [
    'basic:rect',
    'basic:rounded-rect',
    'basic:ellipse',
    'flowchart:database',
    'flowchart:queue',
    'other:rect',
    'icons-lucide:globe',
    'effects-core:dot',
  ])
    r.shapeDefs.register(id, { id } as unknown as ShapeDef, id.split(':')[0] ?? id);
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  r.themes.register('themes-core:ocean', { ...LIGHT_THEME, id: 'themes-core:ocean', name: 'ocean' }, 'themes-core');
  return r;
}
const resolve = (text: string) => {
  const parsed = parseFlux(text);
  if (!parsed.root) throw new Error(JSON.stringify(parsed.diagnostics));
  const read = readFlux(parsed.root, text);
  if (!read.ast) throw new Error(JSON.stringify(read.diagnostics));
  return resolveFlux(read.ast, registries());
};
const doc = (body: string, head = 'uses: [basic, flowchart]\n') => `flux: 1\ntitle: t\n${head}screens:\n${body}`;
const problems = (text: string) => resolve(text).diagnostics.map((d) => [d.code, d.severity, d.path, d.source?.line, d.hint]);

describe('resolve stage (FR-DSL-006, ADR-0030)', () => {
  it('FR-DSL-006: short shape names resolve through the used packs, qualified ones directly; the theme and its tokens resolve', () => {
    const r = resolve(
      doc(
        `  - id: a
    background: color.surface
    nodes:
      web: { shape: rounded-rect, style: { fill: color.primary } }
      db: { shape: database }
      q: { shape: flowchart:queue }
      note: { text: Hello }
    edges:
      - web -> db
`,
        'theme: { preset: ocean, overrides: { color.primary: "#000" } }\nuses: [basic, flowchart]\n',
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(Object.fromEntries(r.resolution.shapes)).toEqual({ web: 'basic:rounded-rect', db: 'flowchart:database', q: 'flowchart:queue' });
    expect(r.resolution.theme.name).toBe('ocean');
    expect(r.resolution.themeId).toBe('themes-core:ocean');
    // no theme: the built-in light one
    expect(resolve(doc('  - id: a\n')).resolution.theme.name).toBe('light');
  });

  it('FR-DSL-006: an unknown shape, slug or token is a diagnostic with line, column and a hint naming the nearest id', () => {
    const text = doc(`  - id: a
    nodes:
      web: { shape: rounded-rct, style: { stroke: color.primry } }
      db: { shape: flowchart:databse }
    edges:
      - web -> dbb
    groups:
      g: { contains: [wbe] }
`);
    expect(problems(text)).toEqual([
      ['FLX_DSL_UNKNOWN_SHAPE', 'error', '/screens/0/nodes/web/shape', 7, 'did you mean "rounded-rect"?'],
      ['FLX_DSL_UNKNOWN_SHAPE', 'error', '/screens/0/nodes/db/shape', 8, 'did you mean "flowchart:database"?'],
      ['FLX_REF_MISSING', 'error', '/screens/0/edges/0/to', 10, 'did you mean "db"?'],
      ['FLX_REF_MISSING', 'error', '/screens/0/groups/g/contains', 12, 'did you mean "web"?'],
      ['FLX_TOKEN_UNKNOWN', 'warning', '/screens/0/nodes/web/style/stroke', 7, 'did you mean "color.primary"?'],
    ]);
    // the edge end's column is the end's own, inside the edge text
    const end = resolve(text).diagnostics.find((d) => d.path.endsWith('/to'));
    expect(end?.source?.col).toBe((text.split('\n')[9] ?? '').indexOf('dbb') + 1);
  });

  it('FR-DSL-006: in block style, an object edge end, a style entry and an override key are placed at their own text', () => {
    const text = doc(
      `  - id: a
    nodes:
      web:
        shape: rect
        style:
          fill: color.surface
          stroke: color.primry
      db: { shape: rect }
    edges:
      - from: web
        to: dbb
      - "web -> dbx"
`,
      'theme:\n  overrides:\n    color.primary: "#000"\n    primry: "#111"\nuses: [basic]\n',
    );
    const lines = text.split('\n');
    const at = (path: string) => resolve(text).diagnostics.find((d) => d.path === path)?.source;
    const where = (line: number, word: string) => ({ line, col: (lines[line - 1] ?? '').indexOf(word) + 1 });
    // an override key that names no token is unknown, with no theme named and without a dot
    expect(at('/theme/overrides/primry')).toMatchObject(where(6, 'primry'));
    expect(at('/theme/overrides/color.primary')).toBeUndefined();
    expect(at('/screens/0/nodes/web/style/stroke')).toMatchObject(where(15, 'color.primry'));
    const to = at('/screens/0/edges/0/to');
    expect(to).toMatchObject(where(19, 'dbb'));
    expect(text.slice(to?.offset, to?.end)).toBe('dbb');
    // a quoted shorthand edge: the end's column is past the quote
    const quoted = at('/screens/0/edges/1/to');
    expect(quoted).toMatchObject(where(20, 'dbx'));
    expect(text.slice(quoted?.offset, quoted?.end)).toBe('dbx');
  });

  it('FR-DSL-006: a shape in two used packs is ambiguous, an unregistered pack a warning, and an unknown theme an error', () => {
    expect(problems(doc('  - id: a\n    nodes:\n      n: { shape: rect }\n', 'uses: [basic, other]\n'))).toEqual([
      ['FLX_DSL_AMBIGUOUS_SHAPE', 'error', '/screens/0/nodes/n/shape', 7, 'name one: basic:rect, other:rect'],
    ]);
    expect(problems(doc('  - id: a\n', 'uses: [basic, flowchrt]\n'))).toEqual([['FLX_DSL_UNKNOWN_PACK', 'warning', '/uses/1', 3, 'did you mean "flowchart"?']]);
    expect(problems(doc('  - id: a\n', 'theme: ligt\nuses: [basic]\n'))).toEqual([['FLX_REF_MISSING', 'error', '/theme', 3, 'did you mean "light"?']]);
    // a theme override must name a token of the theme
    expect(problems(doc('  - id: a\n', 'theme: { preset: light, overrides: { color.primry: "#000" } }\nuses: [basic]\n'))[0]?.[0]).toBe('FLX_TOKEN_UNKNOWN');
  });

  it('FR-DSL-006: slugs and screen ids are unique, and an edge to another screen names that screen', () => {
    const text = doc(`  - id: a
    nodes:
      web: { shape: rect }
  - id: a
    nodes:
      web: { shape: rect }
  - id: b
    nodes:
      api: { shape: rect }
    edges:
      - api -> web
`);
    const d = resolve(text).diagnostics;
    expect(d.map((x) => [x.code, x.path])).toEqual([
      ['FLX_DSL_DUP_SLUG', '/screens/1/id'],
      ['FLX_DSL_DUP_SLUG', '/screens/1/nodes/web'],
      ['FLX_REF_MISSING', '/screens/2/edges/0/to'],
    ]);
    expect(d[0]?.message).toContain('line 5');
    expect(d[2]?.hint).toContain('screen "a"');
  });

  it('FR-DSL-006: the documented checkout example resolves with nothing to report', () => {
    expect(resolve(CHECKOUT).diagnostics).toEqual([]);
  });
});
