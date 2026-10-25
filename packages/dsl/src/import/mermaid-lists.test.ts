import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { type DocumentFile, serializeDocument, validate } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { importMermaid } from './mermaid/mermaid.js';

function registries() {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

describe('Mermaid flowchart node lists', () => {
  it('FR-DSL-007: expands both sides and chained lists into every directed edge', () => {
    const result = importMermaid('flowchart LR\n A & B --> C & D --> E\n');
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.flux?.split('\n').filter((line) => line.startsWith('      - '))).toEqual([
      '      - a -> c',
      '      - a -> d',
      '      - b -> c',
      '      - b -> d',
      '      - c -> e',
      '      - d -> e',
    ]);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(result.flux).toContain(`${id}: { shape: rect, label: "${id.toUpperCase()}" }`);
  });

  it('FR-DSL-007: keeps list labels, edge labels, groups and standalone node lists', () => {
    const result = importMermaid('flowchart TD\n subgraph group [Group]\n a[Salt & Pepper] & b[Other] -->|yes & no| c[Next] & d[Last]\n x & y\n end\n');
    expect(result.diagnostics).toEqual([]);
    expect(result.flux).toContain('a: { shape: rect, label: "Salt & Pepper" }');
    expect(result.flux).toContain('group: { label: "Group", contains: [a, b, c, d, x, y]');
    const edges = result.flux?.split('\n').filter((line) => line.startsWith('      - '));
    expect(edges).toEqual([
      '      - { from: a, to: c, op: "->", label: "yes & no" }',
      '      - { from: a, to: d, op: "->", label: "yes & no" }',
      '      - { from: b, to: c, op: "->", label: "yes & no" }',
      '      - { from: b, to: d, op: "->", label: "yes & no" }',
    ]);
  });

  it('FR-DSL-007: numeric IDs stay distinct, preserve labels and compile to deterministic valid records', () => {
    const source = 'flowchart TD\n 1 & 2 --> 01 & n\n 1[First]\n';
    const result = importMermaid(source);
    expect(result.diagnostics).toEqual([]);
    expect(result).toEqual(importMermaid(source));
    expect(result.flux).toContain('n: { shape: rect, label: "First" }');
    expect(result.flux).toContain('n-2: { shape: rect, label: "2" }');
    expect(result.flux).toContain('n-3: { shape: rect, label: "01" }');
    expect(result.flux).toContain('n-4: { shape: rect, label: "n" }');
    expect(result.flux?.split('\n').filter((line) => line.startsWith('      - '))).toEqual([
      '      - n -> n-3',
      '      - n -> n-4',
      '      - n-2 -> n-3',
      '      - n-2 -> n-4',
    ]);
    const a = compile(result.flux ?? '', { registries: registries() });
    const b = compile(result.flux ?? '', { registries: registries() });
    expect(a.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(a.doc).toBeDefined();
    expect(serializeDocument(a.doc as DocumentFile)).toBe(serializeDocument(b.doc as DocumentFile));
    expect(validate(a.doc as DocumentFile).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('FR-DSL-007: malformed lists report syntax errors at their source line', () => {
    for (const body of ['a &', 'a && b', 'a --> b &', '& a --> b']) {
      const result = importMermaid(`flowchart TD\n${body}\n`);
      expect(result.ok, body).toBe(false);
      expect(
        result.diagnostics.some((d) => d.code === 'FLX_IMPORT_SYNTAX' && d.source?.line === 2),
        body,
      ).toBe(true);
    }
  });

  it('FR-DSL-007: bounds total expanded edges and refuses excess with a positioned diagnostic', () => {
    const sources = Array.from({ length: 200 }, (_, i) => `s${i}`).join(' & ');
    const targets = Array.from({ length: 100 }, (_, i) => `t${i}`).join(' & ');
    const body = `${sources} --> ${targets}`;
    const boundary = importMermaid(`flowchart TD\n${body}\n`);
    expect(boundary.ok).toBe(true);
    expect(boundary.flux?.split('\n').filter((line) => line.startsWith('      - '))).toHaveLength(20_000);
    for (const source of [`flowchart TD\n${sources} & extra --> ${targets}\n`, `flowchart TD\n${body}\ns0 --> t0\n`]) {
      const result = importMermaid(source);
      expect(result.ok).toBe(false);
      expect(result.flux).toBeUndefined();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'FLX_IMPORT_SYNTAX',
          severity: 'error',
          message: expect.stringContaining('20000'),
          source: expect.objectContaining({ line: source.split('\n').length - 1 }),
        }),
      ]);
    }
  });

  it('FR-DSL-007: unsupported directives still report warnings beside supported lists', () => {
    const result = importMermaid('flowchart TD\n a & b --> c\n click a callback\n');
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.source?.line])).toEqual([['FLX_IMPORT_UNSUPPORTED', 'warning', 3]]);
  });
});
