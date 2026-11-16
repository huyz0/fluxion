// NFR-SEC-001: an input outside `fluxion pack-import`'s bounds is refused within 10 s and writes nothing. Split from
// cli.pack-import.test.ts (M19.59).
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeZip } from '@fluxion/format';
import { afterAll, describe, expect, it } from 'vitest';
import { CORPUS, meta, packImport, phasesOf, testDir } from './pack-import-fixture.js';

const dir = testDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
    const r = packImport([args[0] as string, ...meta(out), ...args.slice(1)], { ...process.env, FLUXION_PACK_IMPORT_PHASES: '1' });
    const total = Math.round(performance.now() - started);
    const marks = phasesOf(r.stderr);
    // where the run's time went, in the ci log: Node start-up before `start`, then reading, the witness start and close (M18.229)
    process.stdout.write(`ADVISORY pack-import-phases ${label} ${JSON.stringify({ total, ...marks })}\n`);
    expect(marks.start, `${label}: ${r.stderr}`).toBeTypeOf('number');
    expect(marks.end, `${label}: ${r.stderr}`).toBeTypeOf('number');
    // the bound is the command's own work, witness close included, from its start to its final outcome. Left out: Node's start-up, and
    // the first witness session's browser start, which no member reaches (ADR-0217: 23.8 s on a slowed macOS runner, ci 42178991600)
    const browserStart = marks['witness-start'] === undefined ? 0 : (marks['witness-ready'] as number) - marks['witness-start'];
    if (label === 'unpainted') expect([marks['witness-start'], browserStart >= 0], label).toEqual([expect.any(Number), true]);
    expect((marks.end as number) - (marks.start as number) - browserStart, label).toBeLessThan(10_000);
    expect(r.status, `${label}: ${r.stdout}`).toBe(1);
    expect(
      JSON.parse(r.stdout)
        .errors.map((e: { message: string }) => e.message)
        .join('\n'),
      label,
    ).toMatch(message);
    // the unpainted refusal names the one unpainted member, and only it: a.svg paints
    if (label === 'unpainted') expect(JSON.parse(r.stdout).errors.map((e: { message: string }) => e.message.split(':')[0])).toEqual(['b.svg']);
    if (label === 'existing') expect(readdirSync(out)).toEqual([]);
    else expect(existsSync(out), label).toBe(false);
  });

  it('NFR-SEC-001: no refusal leaves a partial pack behind', () => {
    expect(readdirSync(dir).filter((name) => name.includes('.partial-'))).toEqual([]);
  });
});
