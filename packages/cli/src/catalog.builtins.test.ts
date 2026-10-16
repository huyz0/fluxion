import { buildCatalog } from '@fluxion/dsl';
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
    expect(catalog.layouts.map((l) => l.id)).toEqual(['grid', 'layered', 'stack']);
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
