// FR-LIB-005 FR-LIB-009: encode the complete pinned Lucide collection (2198 icons) as a saveable pack; the nightly perf job
// (scripts/ci/perf-baseline.mjs) holds its p99 to ICONIFY_PACK_2198_MAX_MS. The collection is imported once, as the
// library holds its report; only the encode (canonical JSON, hashing and validation of every file) is timed.
import { allowsShapePackContentLicense } from '@fluxion/core';
import { describe, test } from 'vitest';
import { importIconifyCollection } from '../src/iconify-import.js';
import { iconifyShapePack } from '../src/imported-pack.js';
import type { SvgPaintWitness } from '../src/svg-import.js';

// Vite's raw glob import: the format package is pure, so the corpus is not read through node:fs.
const FILES = import.meta.glob('../../../specs/import/corpus/iconify/lucide.json', { query: '?raw', import: 'default', eager: true });
const LUCIDE = Object.values(FILES)[0] ?? 'null';
// Pure orchestration port, not evidence of actual host paint.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });

describe('imported pack encode (FR-LIB-005)', () => {
  test('FR-LIB-005: iconify-pack-2198', { timeout: 120_000 }, async ({ bench }) => {
    const report = await importIconifyCollection(LUCIDE, { witness });
    const first = iconifyShapePack(report, { licensePolicy: allowsShapePackContentLicense });
    if (!first.ok || first.value.index.definitions.length !== 2198) throw new Error('the full Lucide collection does not encode to 2198 definitions');
    await bench('iconify-pack-2198', { async: false }, () => {
      iconifyShapePack(report, { licensePolicy: allowsShapePackContentLicense });
    }).run({ time: 5_000, warmupTime: 500 });
  });
});
