import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIAGNOSTIC_CODES, type DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { documentFaces } from './render-svg.js';

const REPO = join(__dirname, '../../../');
const HASH = (n: number) => String(n).repeat(64).slice(0, 64);

/** A document whose records are `assets` beside one screen. */
function withAssets(assets: readonly Record<string, unknown>[]): DocumentFile {
  const b = documentBuilder({ title: 'Fonts', seed: 7 });
  b.screen({ size: { w: 100, h: 100 } });
  const built = b.build();
  return { ...built, records: { ...built.records, ...Object.fromEntries(assets.map((a) => [a['id'], a])) } } as DocumentFile;
}
const font = (id: string, hash: string, face: Record<string, unknown>, mime = 'font/woff2') => ({
  id,
  type: 'asset',
  hash,
  mime,
  size: 4,
  name: `${id}.woff2`,
  font: face,
});

describe('render --format svg: the faces a document lends its export (FR-CLI-002, FR-EXP-004)', () => {
  it("FR-CLI-002: a document's font assets with bytes are faces, verified only for a catalog source under an allowed licence", () => {
    const bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
    const doc = withAssets([
      font('a1', HASH(1), { family: 'Lato', weight: 700, style: 'italic', source: 'google', license: 'OFL-1.1', copyright: '(c) Lato' }),
      font('a2', HASH(2), { family: 'Mine', weight: 400, style: 'normal', source: 'upload', license: 'OFL-1.1' }),
      // no bytes in what was opened (a .flux.json), an artwork alias, an image and a font record without a family are no faces
      font('a3', HASH(3), { family: 'Gone', weight: 400 }),
      font('a4', HASH(4), { family: 'fx-artwork-0123456789ab', weight: 400 }),
      { id: 'a5', type: 'asset', hash: HASH(5), mime: 'image/png', size: 4, name: 'p.png' },
      font('a6', HASH(6), { weight: 400 }),
    ]);
    const held = new Map([HASH(1), HASH(2), HASH(4), HASH(5), HASH(6)].map((h) => [h, bytes]));
    const faces = documentFaces(doc, (hash) => held.get(hash));
    expect(faces).toEqual([
      { family: 'Lato', weight: 700, style: 'italic', bytes, rights: 'OFL-1.1\n(c) Lato', verifiedSource: true },
      { family: 'Mine', weight: 400, style: 'normal', bytes, rights: 'OFL-1.1', verifiedSource: false },
    ]);
  });

  it('FR-CLI-002: every code the SVG export reports is a registered diagnostic, so --json can carry it', () => {
    const sources = ['packages/render/src', 'packages/exporters/src'].flatMap((dir) =>
      readdirSync(join(REPO, dir))
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        .map((f) => readFileSync(join(REPO, dir, f), 'utf8')),
    );
    const codes = new Set(sources.flatMap((text) => [...text.matchAll(/code: '(FLX_EXPORT_[A-Z_]+)'/g)].map((m) => m[1] as string)));
    expect(codes.size).toBeGreaterThan(5);
    expect([...codes].filter((c) => !(c in DIAGNOSTIC_CODES))).toEqual([]);
  });
});
