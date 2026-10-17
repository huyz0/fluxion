import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compile.js';
import { layoutDocument } from '../../layout-document.js';
import { OUTLINE } from './__fixtures__/outline.js';
import { importMarkdown } from './markdown.js';

const SHAPES = ['rect', 'rounded-rect', 'ellipse', 'diamond', 'hexagon', 'cylinder', 'parallelogram', 'document'];

function registries() {
  const r = createCoreRegistries();
  for (const s of SHAPES) r.shapeDefs.register(`basic:${s}`, { id: `basic:${s}` } as unknown as ShapeDef, 'basic');
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

describe('importMarkdown (FR-IMP-002, ADR-0040)', () => {
  it('FR-IMP-002: the outline fixture gives five screens, compiles without errors, lays out, and its FluxScript golden holds', async () => {
    const r = importMarkdown(OUTLINE);
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    await expect(r.flux).toMatchFileSnapshot('./__fixtures__/outline.flux.yaml');
    const reg = registries();
    const c = compile(r.flux ?? '', { registries: reg });
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(c.stats.screens).toBe(5);
    expect(layoutDocument(c.doc as NonNullable<typeof c.doc>, reg).ok).toBe(true);
  });

  it('FR-IMP-002: the level-1 heading is the deck title, and the options title applies only without one', () => {
    expect(importMarkdown(OUTLINE).flux).toContain('title: "Launch plan"');
    expect(importMarkdown('## A\n\ntext\n', { title: 'Mine' }).flux).toContain('title: "Mine"');
    expect(importMarkdown('## A\n\ntext\n').flux).toContain('title: "Imported outline"');
  });

  it('FR-IMP-002: nested bullets are a tree of edges and an ordered list is a chain', () => {
    const flux = importMarkdown(OUTLINE).flux ?? '';
    expect(flux).toContain('- grow-signups -> referral-programme');
    expect(flux).toContain('- grow-signups -> pricing-page');
    expect(flux).toContain('- build -> review');
    expect(flux).toContain('- review -> ship');
  });

  it('FR-IMP-002: a mermaid fence becomes a diagram screen titled by its heading, and a rule starts an untitled screen that the next heading names', () => {
    const flux = importMarkdown(OUTLINE).flux ?? '';
    expect(flux).toContain('title: "Architecture"');
    expect(flux).toContain('web: { shape: rect, label: "Web" }');
    expect(flux).toContain('direction: right');
    expect(flux).not.toContain('Screen 3');
  });

  it('FR-IMP-002: raw HTML is an FLX_IMPORT_UNSUPPORTED warning at its own line and the rest still imports', () => {
    const r = importMarkdown(OUTLINE);
    const un = r.diagnostics.filter((d) => d.code === 'FLX_IMPORT_UNSUPPORTED');
    expect(un.map((d) => [d.source?.line, d.message])).toEqual([[OUTLINE.split('\n').indexOf('<div>raw</div>') + 1, expect.stringContaining('raw HTML')]]);
    expect(r.ok).toBe(true);
  });

  it('FR-IMP-002: a mermaid error is reported at its line in the Markdown file, and an unsupported kind gives no file', () => {
    const r = importMarkdown('# T\n\n```mermaid\npie title x\n```\n');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ code: 'FLX_IMPORT_UNKNOWN_KIND', source: { line: 4 } });
    expect(r.flux).toBeUndefined();
  });

  it('FR-IMP-002: an empty file is FLX_IMPORT_SYNTAX, and a heading alone is a one-node title screen', () => {
    expect(importMarkdown('')).toMatchObject({ ok: false, diagnostics: [{ code: 'FLX_IMPORT_SYNTAX' }] });
    expect(importMarkdown('# Only title\n').flux).toContain('label: "Only title"');
  });

  it('FR-IMP-002: the import is deterministic and screen ids are unique slugs', () => {
    expect(importMarkdown(OUTLINE)).toEqual(importMarkdown(OUTLINE));
    const ids = [...(importMarkdown('## Same\n\n- a\n\n## Same\n\n- b\n').flux ?? '').matchAll(/^ {2}- id: (\S+)/gm)].map((m) => m[1]);
    expect(ids).toEqual(['same', 'same-2']);
  });

  it('FR-IMP-002: two mermaid fences under one heading are both titled by it, after the title slide', () => {
    const flux = importMarkdown('# D\n\n## Arch\n\n```mermaid\nflowchart LR\n a --> b\n```\n\n```mermaid\nflowchart LR\n c --> d\n```\n').flux ?? '';
    expect([...flux.matchAll(/^ {4}title: (.+)$/gm)].map((m) => m[1])).toEqual(['"D"', '"Arch"', '"Arch"']);
  });
});
