// NFR-SEC-001 FR-AST-003: read a crafted 1.6 MB recorded font.subset.unicodes (200 001 parts) against 5000 codepoints; the nightly perf job
// (scripts/ci/perf-baseline.mjs) holds its p99 to SUBSET_RANGE_READ_MAX_MS (M18.209: the unit suite proves the bound by scaling instead).
import type { AnyRecord, DocumentFile } from '@fluxion/schema';
import { describe, test } from 'vitest';
import { subsetFontGaps } from '../src/font-subset-save.js';

const PARTS = Array.from({ length: 200_000 }, (_, i) => `U+${(0x20000 + 2 * i).toString(16).toUpperCase()}`);
const UNICODES = ['U+4E00-4E0F', ...PARTS].join(',');
const CJK = Array.from({ length: 5000 }, (_, i) => 0x4e00 + i);
const FONT = { id: 'f1', type: 'asset', mime: 'font/woff2', font: { subset: { unicodes: UNICODES } } } as unknown as AnyRecord;
const DOC = { records: { f1: FONT } } as unknown as DocumentFile;

describe('recorded subset range read (NFR-SEC-001)', () => {
  test('NFR-SEC-001: subset-range-read', { timeout: 120_000 }, async ({ bench }) => {
    const gaps = subsetFontGaps(DOC, CJK);
    if (gaps.length !== 1 || gaps[0]?.missing.length !== CJK.length - 16) throw new Error('the crafted range does not read back as 16 covered codepoints');
    await bench('subset-range-read', { async: false }, () => {
      subsetFontGaps(DOC, CJK);
    }).run({ time: 5_000, warmupTime: 500 });
  });
});
