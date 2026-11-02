// FR-LIB-004 NFR-SEC-001 NFR-LIC-003: the built `fluxion pack-import` (ADR-0206) turns the frozen 50-SVG corpus, as a folder or a
// ZIP, into one byte-identical pack directory under the shipped Chromium paint witness, each member credited to its declared rights;
// an input outside the bounds is refused within 10 s and writes nothing. A folder named unlike its slug's title form keeps its name
// in a pack 1.2 (ADR-0210).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, writeZip } from '@fluxion/format';
import { allowsShapePackContentLicense, createArtworkShapePackLoader } from '@fluxion/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { fluxion, REPO, witnessAdvisories } from './spawn-bin.js';

const CORPUS = join(REPO, 'specs/import/corpus');
const dir = mkdtempSync(join(tmpdir(), 'fluxion-pack-import-e2e-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Manifest = {
  readonly sources: readonly {
    id: string;
    repository?: string;
    commit?: string;
    license: string;
    attribution: string;
    notice: string;
    originalStatement?: string;
  }[];
  readonly svg: readonly { path: string; source: string; sha256: string; upstreamPath?: string }[];
};
const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as Manifest;
const member = (path: string) => path.slice('svg/'.length);
/** `fluxion pack-import`, echoing the CLI's WITNESS_CLEANUP lines whether it succeeds or fails, so each slow close is in the ci log (M18.201). */
function packImport(args: readonly string[]) {
  const r = fluxion(['pack-import', ...args]);
  for (const line of witnessAdvisories(r.stderr)) process.stdout.write(`${line}\n`);
  return r;
}

/**
 * The corpus's declared rights as a `--credits` file: one upstream credit per Lucide member, pinned to its upstream path at the
 * manifest commit and to its manifest hash, and one original credit for the Fluxion members (ADR-0206).
 */
function creditsFile(): string {
  const source = (id: string) => manifest.sources.find((s) => s.id === id) as Manifest['sources'][number];
  const lucide = source('lucide');
  const original = source('fluxion-original');
  const upstream = manifest.svg
    .filter((e) => e.source === 'lucide')
    .map((e) => ({
      id: member(e.path).replace(/\.svg$/, ''),
      license: lucide.license,
      attribution: lucide.attribution,
      noticeFile: lucide.notice,
      source: { kind: 'upstream', reference: `${lucide.repository}@${lucide.commit}:${e.upstreamPath}`, sha256: e.sha256 },
      members: [member(e.path)],
    }));
  const own = {
    id: 'fluxion',
    license: original.license,
    attribution: original.attribution,
    noticeFile: original.notice,
    source: { kind: 'original', author: 'Fluxion contributors', statement: original.originalStatement },
    members: manifest.svg.filter((e) => e.source === 'fluxion-original').map((e) => member(e.path)),
  };
  const path = join(dir, 'credits.json');
  writeFileSync(
    path,
    JSON.stringify({ license: 'ISC AND MIT', attribution: 'Lucide Icons and Contributors; Fluxion contributors', credits: [...upstream, own] }),
  );
  // notice files resolve beside the credits file, so it is copied next to the corpus licenses
  cpSync(join(CORPUS, 'licenses'), join(dir, 'licenses'), { recursive: true });
  return path;
}

const corpusZip = (): string => {
  const svg = join(CORPUS, 'svg');
  const zip = writeZip(
    readdirSync(svg)
      .sort()
      .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(svg, name))) })),
  );
  if (!zip.ok) throw new Error(zip.error.reason);
  const path = join(dir, 'corpus.zip');
  writeFileSync(path, zip.value);
  return path;
};
const meta = (out: string) => ['-o', out, '--namespace', 'corpus', '--version', '1.0.0', '--name', 'Import corpus', '--json'];

/** Every file under `root` by relative path, as base64. */
const tree = (root: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(root.length + 1))
      .sort()
      .map((p) => [p, readFileSync(join(root, p), 'base64')]),
  );

describe('fluxion pack-import of the 50-SVG corpus (M18.16)', () => {
  // the folder and the ZIP import are two tests (M18.224, cp33 F1): as one they used 61% of the 120 s timeout on ubuntu
  const fromFolder = join(dir, 'folder-pack');
  it('FR-LIB-004 NFR-LIC-003: a folder of the 50-SVG corpus gives a pack of 50 shapes that loads clean, each credit scoped to its members', {
    timeout: 120_000,
  }, async () => {
    const a = packImport([join(CORPUS, 'svg'), ...meta(fromFolder), '--credits', creditsFile()]);
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
    const b = packImport([corpusZip(), ...meta(fromZip), '--credits', creditsFile()]);
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

describe('fluxion pack-import refusals (NFR-SEC-001)', () => {
  /** Rewrites the declared uncompressed size (local and central headers) of every entry declaring `from` to `to`: a bomb by its headers. */
  function inflate(bytes: Uint8Array, from: number, to: number): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offsets = new Map([
      [0x04034b50, 22],
      [0x02014b50, 24],
    ]);
    for (let i = 0; i + 4 <= bytes.length; i++) {
      const at = offsets.get(view.getUint32(i, true));
      if (at !== undefined && view.getUint32(i + at, true) === from) view.setUint32(i + at, to, true);
    }
  }
  /** A ZIP of `entries`; an entry of exactly `BOMB` characters is declared to inflate to `inflated` bytes. */
  function zip(name: string, entries: { name: string; text: string | Uint8Array; method?: 'store' }[], inflated?: number): string {
    const written = writeZip(
      entries.map((e) => ({
        name: e.name,
        bytes: typeof e.text === 'string' ? new TextEncoder().encode(e.text) : e.text,
        ...(e.method ? { method: e.method } : {}),
      })),
    );
    if (!written.ok) throw new Error(written.error.reason);
    if (inflated !== undefined) inflate(written.value, BOMB.length, inflated);
    const path = join(dir, name);
    writeFileSync(path, written.value);
    return path;
  }
  const square = '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
  // repetitive, so it is deflated rather than stored: a stored entry's declared size must equal its bytes
  const BOMB = `<svg viewBox="0 0 1 1">${'<g/>'.repeat(997)}</svg>`;
  const MiB = 1024 * 1024;
  const rights = ['--license', 'MIT', '--attribution', 'Me', '--author', 'Me'];
  /** A folder `name` of `members` (path → text, the square by default). */
  const named = (name: string, members: Record<string, string>) => {
    const folder = join(dir, name);
    for (const [m, text] of Object.entries(members)) {
      mkdirSync(join(folder, m, '..'), { recursive: true });
      writeFileSync(join(folder, m), text);
    }
    return folder;
  };

  // one test per refusal (M18.224, cp33 F1): as one test the thirteen CLI runs used 73% of its 90 s on ubuntu; fixtures are built per case
  const uncreditedCredits = () => {
    const path = join(dir, 'uncredited.json');
    writeFileSync(
      path,
      JSON.stringify({
        license: 'MIT',
        attribution: 'Me',
        credits: [
          { id: 'me', license: 'MIT', attribution: 'Me', notice: 'MIT', source: { kind: 'original', author: 'Me', statement: 'Mine.' }, members: ['a.svg'] },
        ],
      }),
    );
    return path;
  };
  const cases: [string, () => readonly string[], RegExp][] = [
    [
      'symlink',
      () => {
        const linked = named('linked', { 'a.svg': square });
        symlinkSync(join(linked, 'a.svg'), join(linked, 'b.svg'));
        return [linked, ...rights];
      },
      /b\.svg is a symbolic link/,
    ],
    ['entries', () => [named('many', Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`s${i}.svg`, '']))), ...rights], /more than 4096 entries/],
    [
      'oversized',
      () => {
        const big = join(dir, 'big.zip');
        writeFileSync(big, '');
        truncateSync(big, 256 * 1024 * 1024 + 1);
        return [big, ...rights];
      },
      /ZIP file exceeds 256 MiB/,
    ],
    ['collision', () => [named('collision', { 'x/A B.svg': square, 'y/a-b.svg': square }), ...rights], /gives the id corpus:a-b/],
    ['slug', () => [named('slug', { '!!!.svg': square }), ...rights], /gives no valid definition id/],
    ['uncredited', () => [named('two', { 'a.svg': square, 'b.svg': square }), '--credits', uncreditedCredits()], /no credit names b\.svg/],
    [
      'existing',
      () => {
        mkdirSync(join(dir, 'refused-existing'));
        return [named('one', { 'a.svg': square }), ...rights];
      },
      /exists/,
    ],
    ['traversal', () => [zip('traversal.zip', [{ name: '../a.svg', text: square }]), ...rights], /\.\.\/a\.svg escapes the input/],
    [
      'bomb',
      () => [zip('bomb.zip', [{ name: 'a.svg', text: BOMB }], 128 * MiB + 1), ...rights],
      /ZIP refused: a\.svg: 134217729 bytes inflated \(more than 134217728\)/,
    ],
    // a real 128 MiB entry and a small one, then one declaring 128 MiB more: the total cap, met before the second is inflated. The real
    // entry is stored: deflating 128 MiB in the test was 10 of the case's 10.5 s under coverage (M18.224), and the cap reads declared sizes
    [
      'inflated-total',
      () => [
        zip(
          'total.zip',
          [
            { name: 'a.svg', text: new Uint8Array(128 * MiB), method: 'store' },
            { name: 'm.svg', text: square },
            { name: 'b.svg', text: BOMB },
          ],
          128 * MiB,
        ),
        ...rights,
      ],
      /ZIP refused: the entries inflate to more than 268435456 bytes/,
    ],
    [
      'zip-entries',
      () => [
        zip(
          'entries.zip',
          Array.from({ length: 4097 }, (_, i) => ({ name: `s${i}.svg`, text: square })),
        ),
        ...rights,
      ],
      /ZIP refused: 4097 entries \(more than 4096\)/,
    ],
    [
      'unpainted',
      () => [named('hidden', { 'a.svg': square, 'b.svg': '<svg viewBox="0 0 10 10"><rect width="10" height="10" opacity="0"/></svg>' }), ...rights],
      /b\.svg: /,
    ],
    ['license', () => [join(CORPUS, 'svg'), '--license', 'LicenseRef-Proprietary', '--attribution', 'Me', '--author', 'Me'], /licen/i],
  ];

  it.each(cases)('NFR-SEC-001: %s is refused with exit 1 within 10 s and leaves nothing', { timeout: 90_000 }, (label, argsOf, message) => {
    const args = argsOf();
    const out = join(dir, `refused-${label}`);
    const started = performance.now();
    const r = packImport([args[0] as string, ...meta(out), ...args.slice(1)]);
    expect(performance.now() - started, label).toBeLessThan(10_000);
    expect(r.status, `${label}: ${r.stdout}`).toBe(1);
    expect(
      JSON.parse(r.stdout)
        .errors.map((e: { message: string }) => e.message)
        .join('\n'),
      label,
    ).toMatch(message);
    if (label === 'existing') expect(readdirSync(out)).toEqual([]);
    else expect(existsSync(out), label).toBe(false);
  });

  it('NFR-SEC-001: no refusal leaves a partial pack behind', () => {
    expect(readdirSync(dir).filter((name) => name.includes('.partial-'))).toEqual([]);
  });
});
