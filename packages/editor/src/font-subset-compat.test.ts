import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FONT_SUBSET_POLICY, glyphInventory, loadFlux, subsetFontGaps, unicodeRangePairs, writeFlux } from '@fluxion/format';
import { describe, expect, it } from 'vitest';

// Format compatibility of subset fonts (FR-AST-003, ADR-0051, ADR-0201, M18.40). fixtures/fonts/fira-sans-subset.flux was written by
// `fluxion convert --subset-fonts` (provenance beside it): a 1.0 reader opens it like any whole-font file, its asset record names the original
// font in `font.subset`, and a writer that does not know that field keeps it and the subset bytes through a re-save.
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const hasher = { sha256: (b: Uint8Array) => Promise.resolve(sha256(b)) };
const FIXTURE = new Uint8Array(readFileSync(new URL('../../../fixtures/fonts/fira-sans-subset.flux', import.meta.url)));
const WHOLE = new Uint8Array(readFileSync(new URL('../../../fixtures/fonts/fira-sans-400.ttf', import.meta.url)));
type Subset = { source: string; sourceSize: number; policy: string; fingerprint: string; unicodes: string };
type FontAsset = { hash: string; mime: string; size: number; name: string; font: { family: string; license: string; copyright: string; subset: Subset } };

describe('subset fonts in a .flux (FR-AST-003, ADR-0201)', () => {
  it('FR-AST-003: a subset file opens with WOFF2 bytes of its hash and the original font identity beside them', async () => {
    const opened = await loadFlux(FIXTURE, { hasher });
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value.notes).toEqual([]);
    const record = opened.value.document.records['f1' as never] as unknown as FontAsset;
    expect(record).toMatchObject({ mime: 'font/woff2', name: 'FiraSans-Regular.woff2', font: { family: 'Fira Sans', license: 'OFL-1.1' } });
    const bytes = opened.value.assets.get(record.hash)?.bytes as Uint8Array;
    expect(sha256(bytes)).toBe(record.hash);
    expect(bytes.length).toBe(record.size);
    expect(record.font.subset).toMatchObject({ source: sha256(WHOLE), sourceSize: WHOLE.length, policy: FONT_SUBSET_POLICY });
    // the recorded range covers exactly what the document draws, so nothing is missing until the text changes
    const inventory = glyphInventory(opened.value.document);
    if (inventory.status !== 'complete') throw new Error(inventory.status);
    const pairs = unicodeRangePairs(record.font.subset.unicodes);
    expect(inventory.codepoints.every((cp) => pairs.some(([a, b]) => cp >= a && cp <= b))).toBe(true);
    expect(subsetFontGaps(opened.value.document, inventory.codepoints)).toEqual([]);
  });

  it('FR-AST-003: a plain re-save keeps the subset metadata and bytes, and reopens to the same document', async () => {
    const opened = await loadFlux(FIXTURE, { hasher });
    if (!opened.ok) throw new Error(opened.error.message);
    const again = await writeFlux({ document: opened.value.document, assets: opened.value.assets, appVersion: '1.0.0', hasher });
    if (!again.ok) throw new Error(again.error.reason);
    const reopened = await loadFlux(again.value, { hasher });
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.value.document).toEqual(opened.value.document);
    const record = reopened.value.document.records['f1' as never] as unknown as FontAsset;
    expect(reopened.value.assets.get(record.hash)?.bytes).toEqual(opened.value.assets.get(record.hash)?.bytes);
  });
});
