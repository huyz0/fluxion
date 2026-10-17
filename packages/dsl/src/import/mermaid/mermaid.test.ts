import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compile.js';
import { layoutDocument } from '../../layout-document.js';
import { SOURCES } from './__fixtures__/sources.js';
import { importMermaid } from './mermaid.js';

const SHAPES = ['rect', 'rounded-rect', 'ellipse', 'diamond', 'hexagon', 'cylinder', 'parallelogram'];

function registries() {
  const r = createCoreRegistries();
  for (const s of SHAPES) r.shapeDefs.register(`basic:${s}`, { id: `basic:${s}` } as unknown as ShapeDef, 'basic');
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

describe('importMermaid (FR-IMP-001, FR-DSL-007, ADR-0040)', () => {
  for (const [kind, source] of Object.entries(SOURCES)) {
    it(`FR-IMP-001: the ${kind} fixture imports, compiles without errors, lays out, and its FluxScript golden holds`, async () => {
      const r = importMermaid(source);
      expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
      await expect(r.flux).toMatchFileSnapshot(`./__fixtures__/${kind}.flux.yaml`);
      const reg = registries();
      const c = compile(r.flux ?? '', { registries: reg });
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(c.doc).toBeDefined();
      const laid = layoutDocument(c.doc as NonNullable<typeof c.doc>, reg);
      expect(laid.ok).toBe(true);
    });
  }

  it('FR-IMP-001: a flowchart keeps node shapes, link labels, chains, groups and the direction', () => {
    const flux = importMermaid('graph TD\n a[A] -->|go| b{B} --> c((C))\n subgraph g [Group]\n  a\n  c\n end\n').flux ?? '';
    expect(flux).toContain('a: { shape: rect, label: "A" }');
    expect(flux).toContain('b: { shape: diamond, label: "B" }');
    expect(flux).toContain('c: { shape: ellipse, label: "C" }');
    expect(flux).toContain('{ from: a, to: b, op: "->", label: "go" }');
    expect(flux).toContain('- b -> c');
    expect(flux).toContain('g: { label: "Group", contains: [a, c]');
    expect(flux).toContain('direction: down');
  });

  it('FR-IMP-001: styling and click lines are FLX_IMPORT_UNSUPPORTED warnings with their line and the rest still imports', () => {
    const r = importMermaid(SOURCES.flowchart);
    const un = r.diagnostics.filter((d) => d.code === 'FLX_IMPORT_UNSUPPORTED');
    expect(un.map((d) => d.source?.line)).toEqual([11, 12]);
    expect(un.every((d) => d.severity === 'warning')).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('FR-IMP-001: a diagram of another kind is FLX_IMPORT_UNKNOWN_KIND and gives no file', () => {
    const r = importMermaid('pie title Pets\n "Dogs" : 5\n');
    expect(r).toMatchObject({ ok: false, diagnostics: [{ code: 'FLX_IMPORT_UNKNOWN_KIND', severity: 'error' }] });
    expect(r.flux).toBeUndefined();
  });

  it('FR-IMP-001: an unclosed subgraph, a stray end, an unreadable statement and an empty source are FLX_IMPORT_SYNTAX', () => {
    for (const bad of [
      'flowchart TD\n subgraph a\n  x --> y\n',
      'flowchart TD\n x --> y\n end\n',
      'flowchart TD\n x --> \n',
      'flowchart TD\n',
      '',
      'sequenceDiagram\n  nonsense here\n',
    ]) {
      const r = importMermaid(bad);
      expect(r.ok, bad).toBe(false);
      expect(
        r.diagnostics.some((d) => d.code === 'FLX_IMPORT_SYNTAX'),
        bad,
      ).toBe(true);
    }
  });

  it('FR-IMP-001: the sequence import numbers the messages, ties notes to a participant and reports the flattened block', () => {
    const r = importMermaid(SOURCES.sequence);
    expect(r.flux).toContain('label: "1. Sign in"');
    expect(r.flux).toContain('op: "~>", label: "2. Token"');
    expect(r.diagnostics.filter((d) => d.code === 'FLX_IMPORT_UNSUPPORTED').map((d) => d.source?.line)).toEqual([7, 9]);
  });

  it('FR-IMP-001: slugs are unique and valid for names that collide or start with a digit', () => {
    const flux = importMermaid('mindmap\n  root((Plan))\n    Plan\n    123\n').flux ?? '';
    const c = compile(flux, { registries: registries() });
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('FR-IMP-001: the same input gives the same output', () => {
    expect(importMermaid(SOURCES.class)).toEqual(importMermaid(SOURCES.class));
  });

  it('FR-IMP-001: options set the deck title and the screen id', () => {
    const flux = importMermaid('flowchart TD\n a --> b\n', { title: 'Mine', screenId: 'main' }).flux ?? '';
    expect(flux).toContain('title: "Mine"');
    expect(flux).toContain('- id: main');
  });
});
