import { buildCatalog, CHEAT_SHEET, compile, formatCatalog } from '@fluxion/dsl';
import { describe, expect, it } from 'vitest';
import { hostRegistries } from './host.js';

describe('the built-in catalog (FR-AI-002)', () => {
  it('FR-AI-002: every shape, marker, route type and layout the CLI host registers has a one-line describe (a dev host refuses any without)', () => {
    const { registries, problems } = hostRegistries(undefined, { requireDescribe: true });
    expect(problems).toEqual([]);
    const { catalog, diagnostics } = buildCatalog(registries);
    expect(diagnostics).toEqual([]);
    expect(catalog.shapes.length).toBeGreaterThanOrEqual(21);
    expect(catalog.connectors.map((c) => c.id)).toEqual(['curved', 'orthogonal', 'polyline', 'straight']);
    expect(catalog.layouts.map((l) => l.id)).toEqual(['grid', 'layered', 'orgchart', 'stack', 'tree']);
    expect(catalog.markers.map((m) => m.id)).toEqual([
      'arrow',
      'bar',
      'basic:crows-foot-many',
      'basic:crows-foot-one',
      'basic:crows-foot-zero-many',
      'basic:crows-foot-zero-one',
      'basic:open-arrow',
      'circle',
      'diamond',
      'triangle',
    ]);
  });
});

describe('the cheat sheet and the catalog text (FR-AI-002)', () => {
  it("FR-AI-002: the cheat sheet's example compiles against the CLI host with no error", () => {
    const { registries } = hostRegistries();
    const example = /```yaml\n([\s\S]*?)```/.exec(CHEAT_SHEET)?.[1] ?? '';
    expect(example).toContain('flux: 1');
    const result = compile(example, { registries });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.doc).toBeDefined();
  });

  it('FR-AI-002: the llm catalog of the bundled packs is the committed golden', async () => {
    const { registries } = hostRegistries(undefined, { requireDescribe: true });
    const text = formatCatalog(buildCatalog(registries, { detail: 'full' }).catalog, 'llm');
    await expect(text).toMatchFileSnapshot('../__golden__/catalog.llm.txt');
  });
});
