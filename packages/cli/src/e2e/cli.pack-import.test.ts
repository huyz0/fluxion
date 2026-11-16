// FR-LIB-004 NFR-LIC-003 FR-AST-003: the built `fluxion pack-import` (ADR-0206) turns the frozen 50-SVG corpus, as a folder or a ZIP,
// into one byte-identical pack directory under the shipped Chromium paint witness, each member credited to its declared rights; the
// corpus's text badge makes a pack 1.1 that keeps its font. The other cases
// are in cli.pack-import-small.test.ts and cli.pack-import-refusals.test.ts (M19.59), so Vitest runs the three files in parallel.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '@fluxion/format';
import { allowsShapePackContentLicense, createArtworkShapePackLoader } from '@fluxion/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { CORPUS, corpusZip, creditsFile, manifest, member, meta, packImport, testDir, tree } from './pack-import-fixture.js';
import { REPO } from './spawn-bin.js';

const dir = testDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('fluxion pack-import of the 50-SVG corpus (M18.16)', () => {
  // the folder and the ZIP import are two tests (M18.224, cp33 F1): as one they used 61% of the 120 s timeout on ubuntu
  const fromFolder = join(dir, 'folder-pack');
  it('FR-LIB-004 NFR-LIC-003: a folder of the 50-SVG corpus gives a pack of 50 shapes that loads clean, each credit scoped to its members', {
    timeout: 120_000,
  }, async () => {
    const a = packImport([join(CORPUS, 'svg'), ...meta(fromFolder), '--credits', creditsFile(dir)]);
    expect(a.status, a.stdout + a.stderr).toBe(0);
    const reply = JSON.parse(a.stdout).result;
    expect([reply.inputCount, reply.svgCount, reply.acceptedCount, reply.definitions.length]).toEqual([50, 50, 50, 50]);
    for (const d of reply.definitions) expect(d.anchors, d.id).toBeGreaterThanOrEqual(4);
    const bySource = new Map(reply.definitions.map((d: { source: string; sourceSha256: string }) => [d.source, d.sourceSha256]));
    for (const e of manifest.svg) expect(bySource.get(member(e.path)), e.path).toBe(e.sha256);

    const index = new Uint8Array(readFileSync(join(fromFolder, 'index.json')));
    const loader = await createArtworkShapePackLoader(index, {
      maxBytes: 256 * 1024 * 1024,
      read: async (path) => new Uint8Array(readFileSync(join(fromFolder, ...path.split('/')))),
      hasher: { sha256: async (bytes) => sha256Hex(bytes) },
      licensePolicy: allowsShapePackContentLicense,
    });
    expect(loader.ok, JSON.stringify(loader)).toBe(true);
    if (!loader.ok) return;
    for (const entry of loader.value.index.definitions) expect((await loader.value.acquire(entry.id)).ok, entry.id).toBe(true);
    const parsed = JSON.parse(new TextDecoder().decode(index));
    expect(parsed.credits).toHaveLength(33);
    const covered = parsed.credits.flatMap((c: { definitionIds: string[] }) => c.definitionIds).sort();
    expect(covered).toEqual(reply.definitions.map((d: { id: string }) => d.id).sort());
    const lucide = parsed.credits.find((c: { id: string }) => c.id === 'lucide-accessibility');
    expect(lucide).toMatchObject({ definitionIds: ['corpus:lucide-accessibility'], source: { kind: 'upstream', sha256: manifest.svg[0]?.sha256 } });
    expect(lucide.notice).toBe(readFileSync(join(CORPUS, 'licenses/lucide.txt'), 'utf8'));
  });

  it("FR-LIB-004 NFR-LIC-003: a ZIP of the 50-SVG corpus gives the folder's pack byte for byte", { timeout: 120_000 }, () => {
    expect(existsSync(join(fromFolder, 'index.json')), 'the folder test runs first and writes its pack').toBe(true);
    const fromZip = join(dir, 'zip-pack');
    const b = packImport([corpusZip(dir), ...meta(fromZip), '--credits', creditsFile(dir)]);
    expect(b.status, b.stdout + b.stderr).toBe(0);
    expect(tree(fromZip)).toEqual(tree(fromFolder));
  });

  it('FR-AST-003: the corpus text badge makes the pack a 1.1 that retains fonts-core Inter under its own OFL credit', { timeout: 60_000 }, () => {
    const input = join(dir, 'badge');
    mkdirSync(input);
    cpSync(join(CORPUS, 'svg/original-label-badge.svg'), join(input, 'badge.svg'));
    const out = join(dir, 'badge-pack');
    const r = packImport([input, ...meta(out), '--license', 'MIT', '--attribution', 'Fluxion contributors', '--author', 'Fluxion contributors']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(index.formatVersion).toBe('1.1');
    const inter = readFileSync(join(REPO, 'packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
    expect(readFileSync(join(out, index.fontResources[0].path))).toEqual(inter);
    expect(index.fontCredits[0]).toMatchObject({ license: 'OFL-1.1', definitionIds: ['corpus:badge'] });
  });
});
