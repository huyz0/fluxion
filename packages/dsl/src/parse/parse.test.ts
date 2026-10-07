import { describe, expect, it } from 'vitest';
import { parseFlux, type YMap, type YNode, type YSeq } from './parse.js';

const SOURCE = `flux: 1
title: How checkout works
theme: { preset: ocean, overrides: { color.accent: "#7C5CFF" } }
uses: [basic, flowchart]
screens:
  - id: arch
    title: Architecture
    layout: { type: stack, options: { gap: 24 } }
    nodes:
      web: { shape: rounded-rect, label: Web }
      queue:
        shape: flowchart:queue
        pin: { x: 1500, y: 820 }
    groups:
      backend: { label: Backend, contains: [web], style: dashed }
    edges:
      - web -> queue: HTTPS
      - pay ~> queue: { label: event }
    notes: |
      Two lines
      of notes.
`;

const map = (n: YNode | undefined): YMap => {
  if (n?.kind !== 'map') throw new Error(`not a map: ${n?.kind}`);
  return n;
};
const seq = (n: YNode | undefined): YSeq => {
  if (n?.kind !== 'seq') throw new Error(`not a sequence: ${n?.kind}`);
  return n;
};
const get = (m: YMap, key: string) => m.entries.find((e) => e.key === key);
/** The 1-based line and column of the first `needle` in `text` at or after `from`. */
const pos = (text: string, needle: string, from = 0) => {
  const i = text.indexOf(needle, from);
  const before = text.slice(0, i).split('\n');
  return { line: before.length, col: (before.at(-1)?.length ?? 0) + 1 };
};

describe('parse stage (FR-DSL-001, ADR-0030)', () => {
  it('FR-DSL-001: every construct parses with its line and column', () => {
    const { root, diagnostics } = parseFlux(SOURCE);
    expect(diagnostics).toEqual([]);
    const top = map(root);
    expect(top.entries.map((e) => e.key)).toEqual(['flux', 'title', 'theme', 'uses', 'screens']);
    expect(get(top, 'flux')).toMatchObject({ keyRange: { line: 1, col: 1 }, value: { kind: 'scalar', value: 1, range: { line: 1, col: 7 } } });
    expect(get(top, 'title')?.value).toMatchObject({ value: 'How checkout works', range: { line: 2, col: 8 } });
    // flow mappings and sequences keep their ranges too
    const theme = map(get(top, 'theme')?.value);
    expect(theme.range).toMatchObject({ line: 3, col: 8 });
    expect(get(map(get(theme, 'overrides')?.value), 'color.accent')?.value).toMatchObject({ value: '#7C5CFF', range: pos(SOURCE, '"#7C5CFF"') });
    expect(seq(get(top, 'uses')?.value).items.map((i) => [i.kind === 'scalar' && i.value, i.range.line, i.range.col])).toEqual([
      ['basic', 4, 8],
      ['flowchart', 4, 15],
    ]);
    const screen = map(seq(get(top, 'screens')?.value).items[0]);
    expect(get(screen, 'id')).toMatchObject({ keyRange: { line: 6, col: 5 }, value: { value: 'arch', range: { line: 6, col: 9 } } });
    const nodes = map(get(screen, 'nodes')?.value);
    expect(nodes.entries.map((e) => [e.key, e.keyRange.line, e.keyRange.col])).toEqual([
      ['web', 10, 7],
      ['queue', 11, 7],
    ]);
    const pin = map(get(map(get(nodes, 'queue')?.value), 'pin')?.value);
    expect(get(pin, 'y')?.value).toMatchObject({ value: 820, range: pos(SOURCE, '820') });
    expect(get(map(get(map(get(screen, 'groups')?.value), 'backend')?.value), 'contains')?.value).toMatchObject({ kind: 'seq', range: pos(SOURCE, '[web]') });
    const edges = seq(get(screen, 'edges')?.value).items.map(map);
    expect(edges.map((e) => [e.entries[0]?.key, e.entries[0]?.keyRange.line, e.entries[0]?.keyRange.col])).toEqual([
      ['web -> queue', 17, 9],
      ['pay ~> queue', 18, 9],
    ]);
    expect(get(screen, 'notes')?.value).toMatchObject({ value: 'Two lines\nof notes.\n', range: pos(SOURCE, '|') });
    // offsets index the text
    const flux = get(top, 'title')?.value;
    expect(SOURCE.slice(flux?.range.offset, flux?.range.end)).toBe('How checkout works');
  });

  it('FR-DSL-001: a syntax error is a diagnostic at its line and column, and the tree is absent', () => {
    const text = 'flux: 1\nscreens:\n  - id: a\n   title: bad indent\n';
    const r = parseFlux(text);
    expect(r.root).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ code: 'FLX_DSL_SYNTAX', severity: 'error', source: { line: 4, col: 1 } });
    const unclosed = parseFlux('flux: 1\ntheme: { preset: ocean\n');
    expect(unclosed.root).toBeUndefined();
    // yaml reports the missing brace where the text ends: line 3, column 1
    expect(unclosed.diagnostics[0]?.source).toMatchObject({ line: 3, col: 1 });
  });

  it('FR-DSL-001: anchors, aliases, tags and duplicate keys are syntax errors with their place and a hint', () => {
    const text = 'flux: 1\nbase: &b { shape: rect }\nother: *b\ntitle: !!str 5\nscreens: []\nscreens: []\n';
    const r = parseFlux(text);
    const at = r.diagnostics.map((d) => ({ code: d.code, line: d.source?.line, col: d.source?.col, hinted: d.hint !== undefined }));
    const expected = [pos(text, '&b'), pos(text, '*b'), pos(text, '!!str'), pos(text, 'screens', text.indexOf('screens') + 1)];
    expect(at).toEqual(expect.arrayContaining(expected.map((p) => ({ code: 'FLX_DSL_SYNTAX', ...p, hinted: true }))));
    expect(r.diagnostics).toHaveLength(4);
    // a duplicate key is not fatal: the tree is still built, so later stages can report more
    expect(r.root?.kind).toBe('map');
  });

  it('FR-DSL-001: empty values are null scalars with a place, and an empty file has no root content', () => {
    const r = parseFlux('flux: 1\ntitle:\nscreens:\n  -\n');
    const top = map(r.root);
    expect(get(top, 'title')?.value).toMatchObject({ kind: 'scalar', value: null, range: { line: 2 } });
    expect(seq(get(top, 'screens')?.value).items[0]).toMatchObject({ kind: 'scalar', value: null });
    expect(parseFlux('').root).toMatchObject({ kind: 'scalar', value: null });
    // a key keeps the text the author wrote, even one the core schema reads as a number (M12.8 review F1)
    expect(map(parseFlux('nodes:\n  007: {a: 1}\n  1e3: x\n  0x10: y\n  true: z\n  "8": w\n').root).entries.map((e) => e.key)).toEqual(['nodes']);
    const nodes = map(get(map(parseFlux('nodes:\n  007: {a: 1}\n  1e3: x\n  0x10: y\n  true: z\n  "8": w\n').root), 'nodes')?.value);
    expect(nodes.entries.map((e) => e.key)).toEqual(['007', '1e3', '0x10', 'true', '8']);
    // an anchor or a tag on a key is refused like one on a value (M12.8 review r2)
    for (const text of ['nodes:\n  &k web: {a: 1}\n', 'nodes:\n  !!str 007: x\n', 'nodes:\n  !foo web: x\n']) {
      const d = parseFlux(text).diagnostics;
      expect(d, text).toHaveLength(1);
      expect(d[0]).toMatchObject({ code: 'FLX_DSL_SYNTAX', source: { line: 2, col: 3 } });
    }
    // one tag, one error (M12.8 review F2)
    expect(parseFlux('flux: 1\nshape: !rect x\n').diagnostics).toHaveLength(1);
    // a complex key is refused
    expect(parseFlux('? [a, b]\n: 1\n').diagnostics.map((d) => d.message)).toContain('a key must be plain text');
  });
});
