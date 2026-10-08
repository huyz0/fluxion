// The FluxScript example corpus (M12.17, FR-DSL-001, FR-DSL-006): every examples/dsl/*.flux.yaml compiles, against the first-party packs and
// built-in layouts a host registers (apps/studio/src/bootstrap.ts), with no error, twice to byte-identical `.flux.json`. Only checkout.flux.yaml
// (06-ai-authoring.md §2) has deferred sections: it warns `FLX_DSL_NOT_YET` and nothing else, and keeps those sections in `document.source`;
// every other example warns nothing. Each also survives a round trip: compile(decompile(compile(src))) equals compile(src) (FR-DSL-002).
// Run: `pnpm --filter @fluxion/dsl test:examples` (scripts/dsl/examples.config.ts says why the runner lives here).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompileResult, compile, decompile, formatDiagnostics } from '@fluxion/dsl';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { themesCorePack } from '@fluxion/pack-themes-core';
import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { type CoreRegistries, createCoreRegistries } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', '..', 'examples', 'dsl');
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.flux.yaml'))
  .sort();
/** The one example with deferred sections. */
const DEFERRED = 'checkout.flux.yaml';

/** Fresh registries as a host has them: the bundled packs, then the built-in layouts. */
function registries(): CoreRegistries {
  const r = createCoreRegistries();
  for (const pack of [basicPack, themesCorePack]) {
    const done = pack.register(r);
    if (!done.ok) throw new Error(`pack ${pack.id} failed to register: ${done.error.map((d) => d.message).join('; ')}`);
  }
  const layouts = registerBuiltInLayouts(r.layouts);
  if (!layouts.ok) throw new Error('the built-in layouts failed to register');
  return r;
}

const run = (text: string): CompileResult => compile(text, { registries: registries() });
const bytes = (r: CompileResult): string => serializeDocument(r.doc as DocumentFile);
const shown = (r: CompileResult): string => formatDiagnostics(r.diagnostics).join('\n');

describe('examples/dsl', () => {
  it('FR-DSL-001: the corpus holds at least 8 examples, checkout.flux.yaml among them', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(8);
    expect(FILES).toContain(DEFERRED);
  });

  describe.each(FILES)('%s', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8');

    it('FR-DSL-001, FR-DSL-006: compiles with no error, twice to byte-identical .flux.json', () => {
      const [a, b] = [run(text), run(text)];
      expect(
        a.diagnostics.filter((d) => d.severity === 'error'),
        shown(a),
      ).toEqual([]);
      expect(a.doc, shown(a)).toBeDefined();
      expect(bytes(b)).toBe(bytes(a));
      console.log(`${file}: ${a.stats.screens} screens, ${a.stats.records} records, ${bytes(a).length} bytes, ${a.diagnostics.length} warnings`);
    });

    it(file === DEFERRED ? 'FR-DSL-001: warns only FLX_DSL_NOT_YET and keeps the deferred sections in document.source' : 'FR-DSL-001: warns nothing', () => {
      const r = run(text);
      if (file !== DEFERRED) {
        expect(r.diagnostics, shown(r)).toEqual([]);
        return;
      }
      expect(r.diagnostics.length).toBeGreaterThan(0);
      expect(new Set(r.diagnostics.map((d) => d.code)), shown(r)).toEqual(new Set(['FLX_DSL_NOT_YET']));
      const document = Object.values(r.doc?.records ?? {}).find((x) => x.type === 'document') as { source?: { deferred?: object } } | undefined;
      // every NOT_YET section is kept by its pointer: the archetype, steps and interactions, and the Mermaid source among them
      const kept = Object.keys(document?.source?.deferred ?? {});
      expect(kept).toEqual(expect.arrayContaining(['/screens/intro/kind', '/screens/arch/steps', '/screens/arch/interactions', '/screens/data-model/mermaid']));
    });

    it('FR-DSL-002: compile(decompile(compile(src))) equals compile(src)', () => {
      const first = run(text);
      const back = decompile(first.doc as DocumentFile, { registries: registries() });
      const again = run(back.text);
      expect(
        again.diagnostics.filter((d) => d.severity === 'error'),
        back.text,
      ).toEqual([]);
      expect(bytes(again), back.text).toBe(bytes(first));
    });
  });
});
