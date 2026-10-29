// FR-LIB-004 FR-AST-003 NFR-LIC-003: the shared pack suite builds and checks a 1.1 pack, with its exact fonts, through the artwork
// loader and the shared encoder (ADR-0192, ADR-0193/0194, M18.81).
import { allowsShapePackContentLicense, type ShapeDef, type ShapePackDraftFonts, sha256Hex } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { buildShapePackFiles, type DeclarativeShapePack } from '../index.js';
import { type CheckedInShapePack, checkShapePack, checkShapePackFiles, shapePackExpectation } from './index.js';

const json = import.meta.glob('../../../../fixtures/shape-pack/v1.1/*.json', { query: '?raw', import: 'default', eager: true });
const inline =
  Object.values(import.meta.glob('../../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?inline', import: 'default', eager: true }))[0] ??
  '';
const INTER = Uint8Array.from(atob(inline.slice(inline.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const SHA = sha256Hex(INTER);
const FONT_PATH = `fonts/${SHA}.woff2`;
const fixture = JSON.parse(json['../../../../fixtures/shape-pack/v1.1/index.json'] ?? 'null');
const subset = JSON.parse(json['../../../../fixtures/shape-pack/v1.1/subset.json'] ?? 'null') as { definitions: ShapeDef[] };
const label = subset.definitions.find((d) => d.id === 'sample:label') as ShapeDef;
const box = subset.definitions.find((d) => d.id === 'sample:box') as ShapeDef;
const credit = fixture.credits[0];
const fontCredit = fixture.fontCredits[0];

const fonts = (bytes: ReadonlyMap<string, Uint8Array> = new Map([[SHA, INTER]])): ShapePackDraftFonts => ({
  fontResources: [{ id: 'inter-400', sha256: SHA, size: INTER.byteLength, mime: 'font/woff2', profile: 'inter-latin-400-ascii', path: FONT_PATH }],
  fontFaces: [{ id: 'inter', family: 'Inter', weight: 400, style: 'normal', resource: 'inter-400' }],
  definitionFonts: [{ definitionId: 'sample:label', faceIds: ['inter'] }],
  fontCredits: [{ ...fontCredit, definitionIds: ['sample:label'] }],
  bytes,
});
const draft: DeclarativeShapePack = {
  id: 'sample',
  version: '1.1.0',
  name: 'Sample',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [credit],
  definitions: [
    { name: 'Box', def: box },
    { name: 'Label', def: label },
  ],
  fonts: fonts(),
};
const checkedIn = (pack: DeclarativeShapePack, versions?: string): CheckedInShapePack => {
  const expected = shapePackExpectation(pack, versions);
  return { pack: expected.pack, fonts: expected.fonts, goldens: expected.goldens, packageJson: `{"version":"${pack.version}"}`, versions: expected.versions };
};
const clean = { files: [], loading: [], brands: [], bounds: [], versions: [] };
const messages = (r: { ok: boolean; error?: readonly { path: string; message: string }[] }) =>
  r.ok ? [] : (r.error ?? []).map((d) => `${d.path} ${d.message}`);

describe('the declarative pack suite for 1.1 packs (M18.81)', () => {
  it('FR-AST-003: builds a 1.1 index and categories as text, with the exact font as the one binary file', () => {
    const built = buildShapePackFiles(draft);
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    expect(Object.keys(built.value)).toEqual(['index.json', 'categories/labels.json']);
    const index = JSON.parse(built.value['index.json'] ?? '');
    expect([index.formatVersion, index.fontResources.map((r: { path: string }) => r.path)]).toEqual(['1.1', [FONT_PATH]]);
    expect(JSON.parse(built.value['categories/labels.json'] ?? '').formatVersion).toBe('1.1');
    expect(Object.keys(shapePackExpectation(draft, undefined).fonts)).toEqual([FONT_PATH]);
    expect(shapePackExpectation(draft, undefined).fonts[FONT_PATH]).toEqual(INTER);
    // the golden draws the artwork text under the exact font's private alias, never the source family
    const golden = shapePackExpectation(draft, undefined).goldens['label.svg'] ?? '';
    // (the normalizer rewrites numbers inside attribute text, so only the reserved prefix is compared)
    expect(/<text[^>]*>/.exec(golden)?.[0]).toMatch(/font-family="fx-artwork-[0-9a-f]+"/);
    expect(golden).not.toContain('Inter');
  });

  it('FR-LIB-004 NFR-LIC-003: the encoder refuses font bytes that are missing, changed or belong to no resource', () => {
    const changed = INTER.slice();
    changed[10] = (changed[10] ?? 0) ^ 1;
    expect(messages(buildShapePackFiles({ ...draft, fonts: fonts(new Map()) }))).toEqual([
      '/fonts/fontResources/0 the bytes of font inter-400 are missing or do not match its SHA-256 and size',
    ]);
    expect(messages(buildShapePackFiles({ ...draft, fonts: fonts(new Map([[SHA, changed]])) }))).toHaveLength(1);
    expect(
      messages(
        buildShapePackFiles({
          ...draft,
          fonts: fonts(
            new Map([
              [SHA, INTER],
              ['f'.repeat(64), INTER],
            ]),
          ),
        }),
      ),
    ).toEqual([`/fonts/bytes font bytes ${'f'.repeat(64)} belong to no resource`]);
    // the artwork text's exact closure is checked by the 1.1 parsers: a label without its binding is refused
    expect(messages(buildShapePackFiles({ ...draft, fonts: { ...fonts(), definitionFonts: [] } })).length).toBeGreaterThan(0);
  });

  it('FR-AST-003 NFR-LIC-003: a built 1.1 pack checks through the artwork loader, which verifies the font it acquires', async () => {
    const files = checkedIn(draft);
    const checked = await checkShapePackFiles(files.pack, allowsShapePackContentLicense, files.fonts);
    if (!checked.ok) throw new Error(JSON.stringify(checked.error));
    expect([checked.value.index.formatVersion, checked.value.definitions.map((d) => d.id)]).toEqual(['1.1', ['sample:box', 'sample:label']]);
    const changed = INTER.slice();
    changed[10] = (changed[10] ?? 0) ^ 1;
    expect(messages(await checkShapePackFiles(files.pack, allowsShapePackContentLicense, { [FONT_PATH]: changed })).join()).toMatch(/SHA-256|hash/i);
    expect(messages(await checkShapePackFiles(files.pack)).join()).toMatch(/inter-400|font/);
    expect(messages(await checkShapePackFiles(files.pack, allowsShapePackContentLicense, { ...files.fonts, 'fonts/extra.woff2': INTER }))).toEqual([
      '/fonts~1extra.woff2 file is not named by the index',
    ]);
  });

  it('FR-LIB-007: checked-in 1.1 files equal to their build are clean; a missing, changed or orphan font is a file problem', async () => {
    const files = checkedIn(draft);
    expect(await checkShapePack(draft, files)).toEqual(clean);
    const changed = INTER.slice();
    changed[10] = (changed[10] ?? 0) ^ 1;
    expect((await checkShapePack(draft, { ...files, fonts: { [FONT_PATH]: changed, 'fonts/old.woff2': INTER } })).files).toEqual([
      `pack/${FONT_PATH} differs from its build`,
      'pack/fonts/old.woff2 belongs to no font resource',
    ]);
    expect((await checkShapePack(draft, { ...files, fonts: {} })).files).toEqual([`pack/${FONT_PATH} is missing`]);
  });

  it('FR-LIB-007: the version ledger records the font hash, so changing a font at a recorded version needs a new version', async () => {
    const files = checkedIn(draft);
    expect(JSON.parse(files.versions ?? '{}')['1.1.0']).toMatchObject({ [FONT_PATH]: SHA });
    const ledger = JSON.parse(files.versions ?? '{}');
    const swapped = `${JSON.stringify({ '1.1.0': { ...ledger['1.1.0'], [FONT_PATH]: '0'.repeat(64) } }, null, 2)}\n`;
    expect((await checkShapePack(draft, { ...files, versions: swapped })).versions).toEqual([
      'category hashes changed at the recorded version 1.1.0: release the change as a new pack version',
    ]);
  });
});
