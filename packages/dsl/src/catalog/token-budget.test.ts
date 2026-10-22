import { createCoreRegistries } from '@fluxion/core';
import { builtInTemplates, registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { countTokens } from '../__fixtures__/token-count.js';
import { buildCatalog } from './catalog.js';
import { CHEAT_SHEET } from './cheatsheet.js';
import { formatCatalog } from './format.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const found = Object.values(import.meta.glob('../../../../scripts/gates/thresholds.mjs', { query: '?raw', import: 'default', eager: true }))[0];
if (found === undefined) throw new Error('thresholds.mjs is missing');
const limit = Number(/AI_CATALOG_MAX_TOKENS: \{ value: ([0-9_]+)/.exec(found)?.[1]?.replaceAll('_', ''));

describe('the size of what a model reads before authoring (NFR-AI-002)', () => {
  const registries = createCoreRegistries();
  registerBuiltInLayouts(registries.layouts);
  registerBuiltInTemplates(registries.templates);
  const catalog = formatCatalog(buildCatalog(registries, { detail: 'full' }).catalog, 'llm');

  it('FR-LAY-014: the catalog lists all 9 templates within AI_CATALOG_MAX_TOKENS', () => {
    // nine kinds of template (process has two variants), each listed with its options, inside the same budget as everything else
    const listed = buildCatalog(registries, { detail: 'full' }).catalog.templates;
    expect(listed.map((t) => t.id).sort()).toEqual(builtInTemplates.map((t) => t.id).sort());
    expect(listed.every((t) => t.describe !== '' && t.detail !== undefined)).toBe(true);
    expect(catalog).toContain('templates:\n');
    expect(countTokens(catalog) + countTokens(CHEAT_SHEET)).toBeLessThanOrEqual(limit);
  });

  it('NFR-AI-002: the threshold is read from thresholds.mjs', () => {
    expect(limit).toBeGreaterThan(0);
  });

  it('NFR-AI-002: the core catalog (full detail) plus the cheat sheet is within AI_CATALOG_MAX_TOKENS, both counted', () => {
    const total = countTokens(catalog) + countTokens(CHEAT_SHEET);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(limit);
  });
});
