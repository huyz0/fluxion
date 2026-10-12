import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { completionCatalog } from './completion-catalog.js';

describe('completionCatalog (FR-DSL-009, ADR-0032)', () => {
  const b = documentBuilder({ seed: 213 });
  const s1 = b.screen();
  b.rect(s1, { slug: 'api' });
  b.rect(s1, {});
  const s2 = b.screen();
  b.rect(s2, { slug: 'other' });
  const core = createCore(b.build());
  const def = (id: `${string}:${string}`) => ({ id, outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 1, h: 1 } });
  for (const id of ['basic:rect', 'basic:line', 'uml:class'] as const) core.registries.shapeDefs.register(id, def(id), 'test');
  let screen: typeof s1 | undefined = s1;
  const cat = completionCatalog({ shapeDefs: core.registries.shapeDefs, view: core.store, screen: () => screen });

  it('FR-DSL-009: shapes and packs come from the registry, tokens from the built-in theme when the document has none', () => {
    expect([...cat.shapes()].sort()).toEqual(['basic:line', 'basic:rect', 'uml:class']);
    expect([...cat.packs()].sort()).toEqual(['basic', 'uml']);
    expect(cat.tokens().length).toBeGreaterThan(5);
    expect(cat.tokens().every((t) => /^[a-z][\w-]*(\.[\w-]+)+$/.test(t))).toBe(true);
    expect(JSON.stringify(LIGHT_THEME.tokens)).toContain(cat.tokens()[0]?.split('.')[0] ?? '');
  });

  it('FR-DSL-009: slugs are those of the open screen, read when asked', () => {
    expect(cat.slugs()).toEqual(['api']);
    screen = s2;
    expect(cat.slugs()).toEqual(['other']);
    screen = undefined;
    expect(cat.slugs()).toEqual([]);
  });
});
