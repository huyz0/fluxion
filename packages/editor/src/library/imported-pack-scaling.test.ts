import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowsShapePackContentLicense } from '@fluxion/core';
import { type IconifyImportReport, iconifyShapePack, importIconifyCollection, type SvgPaintWitness } from '@fluxion/format';
import { describe, expect, it } from 'vitest';

// M18.126 (cp13 F4): encoding an imported collection grows at most linearly with its size. The complete pinned Lucide collection
// (2198 icons) is imported once; a 1-in-16 sample of its report and the whole report are encoded alternately, and the median time
// per definition of the whole may be at most 3 times the sample's (a quadratic encoder would be about 16 times). The absolute budget
// is the nightly perf job's (packages/format/bench/iconify-pack-2198.bench.ts, ICONIFY_PACK_2198_MAX_MS).
const LUCIDE = readFileSync(join(import.meta.dirname, '../../../../specs/import/corpus/iconify/lucide.json'), 'utf8');
// Pure orchestration port, not evidence of actual host paint.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
const RUNS = 5;
const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

/** Milliseconds to encode `report`, and the definitions it encodes. */
function encode(report: IconifyImportReport): { ms: number; definitions: number } {
  const start = performance.now();
  const pack = iconifyShapePack(report, { licensePolicy: allowsShapePackContentLicense });
  const ms = performance.now() - start;
  if (!pack.ok) throw new Error(JSON.stringify(pack.error));
  return { ms, definitions: pack.value.index.definitions.length };
}

describe('imported pack encoding scales linearly (FR-LIB-005, FR-LIB-009)', () => {
  it('FR-LIB-005 FR-LIB-009: the full 2198-icon collection costs at most 3 times per definition what a 1-in-16 sample does', { timeout: 180_000 }, async () => {
    const full = await importIconifyCollection(LUCIDE, { witness });
    if (full.status !== 'processed') throw new Error('the pinned Lucide collection does not import');
    const sample: IconifyImportReport = { ...full, entries: full.entries.filter((_, i) => i % 16 === 0) };
    // one warm-up each, then alternate so machine load falls on both alike
    encode(sample);
    encode(full);
    const [small, large]: [number[], number[]] = [[], []];
    let counts = { small: 0, large: 0 };
    for (let i = 0; i < RUNS; i++) {
      const a = encode(sample);
      const b = encode(full);
      small.push(a.ms / a.definitions);
      large.push(b.ms / b.definitions);
      counts = { small: a.definitions, large: b.definitions };
    }
    expect(counts.large).toBe(2198);
    expect(counts.large / counts.small).toBeGreaterThan(15);
    const ratio = median(large) / median(small);
    expect(ratio, `per-definition cost: ${median(large).toFixed(3)} ms full vs ${median(small).toFixed(3)} ms sample`).toBeLessThanOrEqual(3);
  });
});
