// FR-LIB-003 FR-LIB-009 FR-LIB-004: `fluxion pack-import` keeps a folder's name unlike its slug's title form (pack 1.2, ADR-0210) and
// converts more members than one witness session admits. Split from cli.pack-import.test.ts (M19.59).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '@fluxion/format';
import { allowsShapePackContentLicense, createArtworkShapePackLoader } from '@fluxion/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { CORPUS, meta, packImport, testDir } from './pack-import-fixture.js';

const dir = testDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('fluxion pack-import category names (M18.211, ADR-0210)', () => {
  it('FR-LIB-003 FR-LIB-009: a folder named unlike its slug title makes a 1.2 pack that keeps the name, replies 1.2 and loads clean', {
    timeout: 60_000,
  }, async () => {
    const input = join(dir, 'named');
    for (const folder of ['Arrows & Pointers', 'data']) mkdirSync(join(input, folder), { recursive: true });
    cpSync(join(CORPUS, 'svg/original-donut.svg'), join(input, 'Arrows & Pointers', 'donut.svg'));
    cpSync(join(CORPUS, 'svg/original-donut.svg'), join(input, 'data', 'ring.svg'));
    const out = join(dir, 'named-pack');
    const r = packImport([input, ...meta(out), '--license', 'MIT', '--attribution', 'Fluxion contributors', '--author', 'Fluxion contributors']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).result.pack).toMatchObject({ id: 'corpus', formatVersion: '1.2' });
    const bytes = new Uint8Array(readFileSync(join(out, 'index.json')));
    const index = JSON.parse(new TextDecoder().decode(bytes));
    // the slug-form folder keeps no name; the other keeps its text, which its slug's title form ('Arrows Pointers') would lose
    expect(index.categories).toMatchObject({ 'arrows-pointers': { name: 'Arrows & Pointers' }, data: {} });
    expect(index.categories.data).not.toHaveProperty('name');
    const loader = await createArtworkShapePackLoader(bytes, {
      maxBytes: 16 * 1024 * 1024,
      read: async (path) => new Uint8Array(readFileSync(join(out, ...path.split('/')))),
      hasher: { sha256: async (b) => sha256Hex(b) },
      licensePolicy: allowsShapePackContentLicense,
    });
    if (!loader.ok) throw new Error(JSON.stringify(loader.error));
    for (const entry of loader.value.index.definitions) expect((await loader.value.acquire(entry.id)).ok, entry.id).toBe(true);
  });
});

describe('fluxion pack-import beyond one witness session (M18.16 r2 F1)', () => {
  it('FR-LIB-004: 129 members, one more than a Node witness session admits, all convert', { timeout: 180_000 }, () => {
    const input = join(dir, 'many-valid');
    mkdirSync(input);
    for (let i = 0; i < 129; i++)
      writeFileSync(join(input, `s${String(i).padStart(3, '0')}.svg`), `<svg viewBox="0 0 ${i + 10} 10"><rect width="${i + 10}" height="10"/></svg>`);
    const out = join(dir, 'many-pack');
    const r = packImport([input, ...meta(out), '--license', 'MIT', '--attribution', 'Me', '--author', 'Me']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).result.acceptedCount).toBe(129);
  });
});
