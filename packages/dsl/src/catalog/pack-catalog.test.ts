// Every first-party pack registered at once (FR-LIB-007, NFR-AI-002, ADR-0211, M18.41): the core catalog a model reads first stays within
// AI_CATALOG_MAX_TOKENS with each other pack one summary line, each pack's own catalog (built with its `pack`) lists all its shapes within the same
// budget, and every shape resolves in FluxScript through `uses:` by its short name, as the pack detail names it. The packs are read from their
// declarative `pack/` distributions (dsl imports no pack) and parsed by core, as a host's loader does.
import {
  allowsShapePackContentLicense,
  type CoreRegistries,
  createCoreRegistries,
  parseVersionedShapePackCategory,
  parseVersionedShapePackIndex,
} from '@fluxion/core';
import { registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { countTokens } from '../__fixtures__/token-count.js';
import { compile } from '../compile.js';
import { buildCatalog } from './catalog.js';
import { CHEAT_SHEET } from './cheatsheet.js';
import { formatCatalog } from './format.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const thresholds = Object.values(import.meta.glob('../../../../scripts/gates/thresholds.mjs', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const limit = Number(/AI_CATALOG_MAX_TOKENS: \{ value: ([0-9_]+)/.exec(thresholds)?.[1]?.replaceAll('_', ''));

const indexes = import.meta.glob('../../../../packs/*/pack/index.json', { query: '?raw', import: 'default', eager: true });
const categories = import.meta.glob('../../../../packs/*/pack/categories/*.json', { query: '?raw', import: 'default', eager: true });

/** The packs the core catalog lists entry by entry: the built-ins and the basic pack, as before every first-party pack registered. */
const CORE = ['core', 'basic'];

type Loaded = { readonly id: string; readonly name: string; readonly shapes: readonly string[] };

/** Every first-party pack's definitions, registered under the pack's id beside the built-in layouts and templates. */
function everyPack(): { readonly registries: CoreRegistries; readonly packs: readonly Loaded[] } {
  const registries = createCoreRegistries();
  registerBuiltInLayouts(registries.layouts);
  registerBuiltInTemplates(registries.templates);
  const packs = Object.entries(indexes).map(([path, text]): Loaded => {
    const raw: unknown = JSON.parse(text);
    const index = parseVersionedShapePackIndex(raw, allowsShapePackContentLicense);
    if (!index.ok) throw new Error(`${path}: ${index.error.map((d) => d.message).join('; ')}`);
    const dir = path.replace(/index\.json$/, '');
    const shapes = Object.keys(index.value.categories).flatMap((category) => {
      const parsed = parseVersionedShapePackCategory(
        JSON.parse(categories[`${dir}categories/${category}.json`] ?? 'null'),
        raw,
        category,
        allowsShapePackContentLicense,
      );
      if (!parsed.ok) throw new Error(`${dir}${category}: ${parsed.error.map((d) => d.message).join('; ')}`);
      return parsed.value.definitions.map((def) => {
        const added = registries.shapeDefs.register(def.id, def, index.value.id);
        if (!added.ok) throw new Error(added.error.message);
        return def.id;
      });
    });
    return { id: index.value.id, name: index.value.name, shapes };
  });
  return { registries, packs };
}

describe('every first-party pack in the AI catalog (FR-LIB-007, NFR-AI-002)', () => {
  const { registries, packs } = everyPack();
  const names = new Map(packs.map((p) => [p.id, p.name]));

  it('FR-LIB-007: reads all twelve first-party packs, each with its shapes', () => {
    expect(packs.map((p) => p.id).sort()).toEqual([
      'arrows',
      'basic',
      'bpmn',
      'callouts',
      'cloud',
      'devices',
      'flowchart',
      'infographic',
      'lucide',
      'network',
      'people',
      'uml',
    ]);
    expect(packs.every((p) => p.shapes.length > 0)).toBe(true);
  });

  it('NFR-AI-002, FR-LIB-007: with every pack registered, the core catalog (full detail) and the cheat sheet stay within AI_CATALOG_MAX_TOKENS, each other pack one line', () => {
    const { catalog, diagnostics } = buildCatalog(registries, { detail: 'full', core: CORE, names });
    expect(diagnostics).toEqual([]);
    expect(new Set(catalog.shapes.map((s) => s.source))).toEqual(new Set(['basic']));
    expect(catalog.packs?.map((p) => [p.id, p.name, p.count])).toEqual(
      packs
        .filter((p) => !CORE.includes(p.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((p) => [p.id, p.name, p.shapes.length]),
    );
    const text = formatCatalog(catalog, 'llm');
    expect(text).toContain('cloud — Cloud architecture; 18 entries (shapes); listed with pack: cloud');
    expect(countTokens(text) + countTokens(CHEAT_SHEET)).toBeLessThanOrEqual(limit);
  });

  it.each(packs.map((p) => [p.id, p] as const))('FR-LIB-007: the %s detail lists every one of its shapes within AI_CATALOG_MAX_TOKENS', (_id, pack) => {
    const { catalog } = buildCatalog(registries, { detail: 'full', pack: pack.id });
    expect(catalog.shapes.map((s) => s.id)).toEqual([...pack.shapes].sort());
    expect(catalog.packs).toBeUndefined();
    expect(countTokens(formatCatalog(catalog, 'llm'))).toBeLessThanOrEqual(limit);
  });

  it.each(packs.map((p) => [p.id, p] as const))(
    'FR-LIB-007: every %s shape resolves in FluxScript through uses: by the short name its detail lists',
    (_id, pack) => {
      const nodes = pack.shapes.map((id, i) => `      n${i}: { shape: ${id.slice(pack.id.length + 1)} }`).join('\n');
      const text = `flux: 1\ntitle: Every ${pack.id} shape\nuses: [${pack.id}]\nscreens:\n  - id: all\n    nodes:\n${nodes}\n`;
      const done = compile(text, { registries });
      expect(done.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const used = Object.values(done.doc?.records ?? {}).flatMap((r) =>
        (r as { defId?: string }).defId === undefined ? [] : [(r as { defId: string }).defId],
      );
      expect(used.sort()).toEqual([...pack.shapes].sort());
    },
  );
});
