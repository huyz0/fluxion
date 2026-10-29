// FR-LIB-004 NFR-SEC-001 NFR-LIC-003: `pack-import` (ADR-0206) against an injected paint witness: rights declared per member,
// bounds checked before anything is read or converted, and `-o` holding a checked pack or nothing.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { type SvgPaintWitness, writeZip } from '@fluxion/format';
import { ok } from '@fluxion/schema';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CliIo, Outcome } from './command.js';
import { runCommands } from './main.js';
import { type PackImportPorts, packImportCommand } from './pack-import.js';
import { slugOf } from './pack-import-input.js';
import { writePackDir } from './pack-import-write.js';

const root = mkdtempSync(join(tmpdir(), 'fluxion-pack-import-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(root, `case-${++n}`);

const SQUARE = '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
const LABEL = '<svg viewBox="0 0 40 20"><text x="2" y="14">API</text></svg>';

/** A folder of `members` (path → text) under a fresh case directory. */
function folder(members: Record<string, string>): string {
  const dir = fresh();
  for (const [path, text] of Object.entries(members)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const painted: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });

/** Ports whose witness answers with `paint`, counting starts and disposals. */
function ports(paint: SvgPaintWitness = painted) {
  const dispose = vi.fn(async () => ok(undefined));
  const witness = vi.fn(async () => ok({ witness: paint, observe: async () => ok({ identity: '', status: 'painted' as const, fontHashes: [] }), dispose }));
  return { ports: { witness } as unknown as PackImportPorts, witness, dispose };
}

/** Runs `pack-import args --json` through the command table; the reply and the exit code. */
async function packImport(args: readonly string[], p: PackImportPorts = ports().ports) {
  let stdout = '';
  const io: CliIo = { stdout: (t) => (stdout += t), stderr: () => {} };
  const code = await runCommands({ 'pack-import': packImportCommand(p) }, ['pack-import', ...args, '--json'], io);
  return { code, reply: JSON.parse(stdout) as { ok: boolean; result?: never; errors?: { message: string }[] } & Record<string, unknown> };
}
const flags = (out: string) => [
  '-o',
  out,
  '--namespace',
  'mine',
  '--version',
  '1.0.0',
  '--name',
  'Mine',
  '--license',
  'MIT',
  '--attribution',
  'Me',
  '--author',
  'Me',
];
const messages = (reply: { errors?: { message: string }[] }) => (reply.errors ?? []).map((e) => e.message).join('\n');

/** Every file under `dir` by relative path with its bytes. */
function tree(dir: string): Record<string, string> {
  return Object.fromEntries(
    (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
      .filter((e) => e.isFile())
      // keyed by `/`-separated pack paths, as the reply names them, on every OS
      .map((e) => [relative(dir, join(e.parentPath, e.name)).split(sep).join('/'), readFileSync(join(e.parentPath, e.name), 'base64')]),
  );
}

describe('pack-import ids, categories and the reply (FR-LIB-004)', () => {
  it('FR-LIB-004: one slug rule names ids; folders name categories; the reply lists each definition with its source', async () => {
    expect(['a/My Icon.svg', '--x--.SVG', 'Ünïcode 2.svg'].map(slugOf)).toEqual(['my-icon', 'x', 'n-code-2']);
    const out = fresh();
    const { code, reply } = await packImport([folder({ 'arrows/Left Arrow.svg': SQUARE, 'box.svg': SQUARE }), ...flags(out)]);
    expect(code, JSON.stringify(reply)).toBe(0);
    expect(reply.result).toMatchObject({
      pack: { id: 'mine', version: '1.0.0', formatVersion: '1.0', dir: out },
      inputCount: 2,
      acceptedCount: 2,
      definitions: [
        { id: 'mine:left-arrow', name: 'Left Arrow', category: 'arrows', source: 'arrows/Left Arrow.svg', anchors: 4, fonts: [] },
        { id: 'mine:box', name: 'box', category: 'uncategorized', source: 'box.svg', anchors: 4, fonts: [] },
      ],
    });
    expect(Object.keys(tree(out)).sort()).toEqual([...(reply.result as unknown as { files: string[] }).files].sort());
  });

  it('FR-AST-003: a member drawing text makes a 1.1 pack holding fonts-core Inter with its own OFL notice', async () => {
    const out = fresh();
    const { code, reply } = await packImport([folder({ 'label.svg': LABEL, 'box.svg': SQUARE }), ...flags(out)]);
    expect(code, JSON.stringify(reply)).toBe(0);
    const inter = readFileSync(new URL('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', import.meta.url));
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(index.formatVersion).toBe('1.1');
    const [font] = index.fontResources;
    expect(readFileSync(join(out, font.path))).toEqual(inter);
    expect(index.fontCredits).toEqual([
      expect.objectContaining({ license: 'OFL-1.1', definitionIds: ['mine:label'], notice: expect.stringContaining('SIL OPEN FONT LICENSE') }),
    ]);
  });
});

describe('pack-import byte identity (FR-LIB-004)', () => {
  it("FR-LIB-004: a ZIP whose entries are in another order gives the folder's bytes, scoped credit ids included", async () => {
    const members = { 'a/b.svg': SQUARE, 'a-c.svg': SQUARE, 'z.svg': LABEL };
    const input = folder(members);
    const zipped = writeZip(
      Object.entries(members)
        .reverse()
        .map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
    );
    if (!zipped.ok) throw new Error(zipped.error.reason);
    const zip = join(fresh(), 'members.zip');
    mkdirSync(join(zip, '..'));
    writeFileSync(zip, zipped.value);
    const credits = join(fresh(), 'credits.json');
    mkdirSync(join(credits, '..'));
    const own = { license: 'MIT', attribution: 'Me', notice: 'MIT License', source: { kind: 'original', author: 'Me', statement: 'Mine.' } };
    writeFileSync(credits, JSON.stringify({ license: 'MIT', attribution: 'Me', credits: [{ id: 'all', ...own, members: ['z.svg', 'a-c.svg', 'a/b.svg'] }] }));
    const meta = (out: string) => ['-o', out, '--namespace', 'mine', '--version', '1.0.0', '--name', 'Mine', '--credits', credits];
    const [fromFolder, fromZip] = [fresh(), fresh()];
    expect((await packImport([input, ...meta(fromFolder)])).code).toBe(0);
    expect((await packImport([zip, ...meta(fromZip)])).code).toBe(0);
    expect(tree(fromZip)).toEqual(tree(fromFolder));
    const index = JSON.parse(readFileSync(join(fromFolder, 'index.json'), 'utf8'));
    expect(index.credits[0].definitionIds).toEqual(['mine:a-c', 'mine:b', 'mine:z']);
  });
});

describe('pack-import rights (NFR-LIC-003)', () => {
  const input = () => folder({ 'lucide/a.svg': SQUARE, 'own/b.svg': SQUARE });
  const creditsFile = (credits: unknown[]) => {
    const path = join(fresh(), 'credits.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(join(path, '..', 'NOTICE.txt'), 'Upstream notice\n');
    writeFileSync(path, JSON.stringify({ license: 'ISC AND MIT', attribution: 'Mixed', credits }));
    return path;
  };
  const upstream = {
    id: 'up',
    license: 'ISC',
    attribution: 'Upstream',
    noticeFile: 'NOTICE.txt',
    source: { kind: 'upstream', reference: 'up@1:a.svg', sha256: 'a'.repeat(64) },
  };
  const own = { id: 'own', license: 'MIT', attribution: 'Me', notice: 'MIT License', source: { kind: 'original', author: 'Me', statement: 'Mine.' } };
  const meta = (out: string) => ['-o', out, '--namespace', 'mine', '--version', '1.0.0', '--name', 'Mine'];

  it('NFR-LIC-003: a --credits file scopes each credit to exactly its members, notice files read beside it', async () => {
    const out = fresh();
    const credits = creditsFile([
      { ...upstream, members: ['lucide/a.svg'] },
      { ...own, members: ['own/b.svg'] },
    ]);
    const { code, reply } = await packImport([input(), ...meta(out), '--credits', credits]);
    expect(code, JSON.stringify(reply)).toBe(0);
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(index.credits.map((c: { id: string; definitionIds: string[]; notice: string }) => [c.id, c.definitionIds, c.notice])).toEqual([
      ['up', ['mine:a'], 'Upstream notice\n'],
      ['own', ['mine:b'], 'MIT License'],
    ]);
  });

  it('NFR-LIC-003: an uncredited, doubly credited or unknown member, or an unpermitted license, is refused and nothing is written', async () => {
    const cases: [unknown[], RegExp][] = [
      [[{ ...upstream, members: ['lucide/a.svg'] }], /no credit names own\/b\.svg/],
      [
        [
          { ...upstream, members: ['lucide/a.svg', 'own/b.svg'] },
          { ...own, members: ['own/b.svg'] },
        ],
        /own\/b\.svg is in credits up and own/,
      ],
      [
        [
          { ...upstream, members: ['lucide/a.svg', 'ghost.svg'] },
          { ...own, members: ['own/b.svg'] },
        ],
        /credits name ghost\.svg/,
      ],
      [
        [
          { ...upstream, license: 'LicenseRef-Proprietary', members: ['lucide/a.svg'] },
          { ...own, members: ['own/b.svg'] },
        ],
        /licen/i,
      ],
    ];
    for (const [credits, message] of cases) {
      const out = fresh();
      const { code, reply } = await packImport([input(), ...meta(out), '--credits', creditsFile(credits)]);
      expect([code, messages(reply)]).toEqual([1, expect.stringMatching(message)]);
      expect(existsSync(out)).toBe(false);
    }
  });

  it('NFR-LIC-003: the rights are declared one way only: flags missing, both forms, or --upstream without its hash are usage errors', async () => {
    const out = fresh();
    const credits = creditsFile([{ ...own, members: ['lucide/a.svg', 'own/b.svg'] }]);
    for (const extra of [[], ['--credits', credits, '--license', 'MIT'], ['--license', 'MIT', '--attribution', 'Me', '--upstream', 'x']]) {
      expect((await packImport([input(), ...meta(out), ...extra])).code).toBe(2);
    }
    expect(existsSync(out)).toBe(false);
  });
});

describe('pack-import bounds (NFR-SEC-001)', () => {
  /** Refused with exit 1, naming `message`, writing nothing, never starting the witness. */
  async function refusedBeforeWitness(input: string, message: RegExp) {
    const out = fresh();
    const p = ports();
    const { code, reply } = await packImport([input, ...flags(out)], p.ports);
    expect([code, messages(reply)]).toEqual([1, expect.stringMatching(message)]);
    expect(existsSync(out)).toBe(false);
    expect(p.witness).not.toHaveBeenCalled();
  }

  it('NFR-SEC-001: a symlink, a non-SVG member, an empty slug and two members with one id are refused, naming the paths', async () => {
    const linked = folder({ 'a.svg': SQUARE });
    symlinkSync(join(linked, 'a.svg'), join(linked, 'b.svg'));
    await refusedBeforeWitness(linked, /b\.svg is a symbolic link/);
    await refusedBeforeWitness(folder({ 'a.svg': SQUARE, 'notes.txt': 'x' }), /notes\.txt is not an SVG/);
    await refusedBeforeWitness(folder({ '!!!.svg': SQUARE }), /!!!\.svg its name gives no valid definition id/);
    await refusedBeforeWitness(folder({ 'x/A B.svg': SQUARE, 'y/a-b.svg': SQUARE }), /y\/a-b\.svg gives the id mine:a-b, as x\/A B\.svg does/);
  });

  it('NFR-SEC-001: the entry-count, per-entry and total caps are met from the listing, before any byte is read', async () => {
    const many = fresh();
    mkdirSync(many);
    for (let i = 0; i <= 4096; i++) writeFileSync(join(many, `s${i}.svg`), '');
    await refusedBeforeWitness(many, /more than 4096 entries/);
    const big = folder({ 'a.svg': SQUARE });
    truncateSync(join(big, 'a.svg'), 128 * 1024 * 1024 + 1);
    await refusedBeforeWitness(big, /a\.svg entry exceeds 128 MiB/);
    const total = folder({ 'a.svg': '', 'b.svg': '', 'c.svg': '' });
    for (const name of ['a.svg', 'b.svg', 'c.svg']) truncateSync(join(total, name), 100 * 1024 * 1024);
    await refusedBeforeWitness(total, /inputs exceed 256 MiB/);
    const zip = join(fresh(), 'big.zip');
    mkdirSync(join(zip, '..'));
    writeFileSync(zip, '');
    truncateSync(zip, 256 * 1024 * 1024 + 1);
    await refusedBeforeWitness(zip, /ZIP file exceeds 256 MiB/);
  });

  it('NFR-SEC-001: an existing -o is refused before reading; neither a file nor a folder input is touched', async () => {
    const out = fresh();
    mkdirSync(out);
    const p = ports();
    const { code, reply } = await packImport([folder({ 'a.svg': SQUARE }), ...flags(out)], p.ports);
    expect([code, messages(reply)]).toEqual([1, expect.stringMatching(/exists/)]);
    expect(readdirSync(out)).toEqual([]);
    await refusedBeforeWitness(join(root, 'missing'), /cannot read/);
  });

  it('FR-LIB-004: one member the witness does not see painted refuses the whole batch; the session is disposed', async () => {
    const out = fresh();
    let calls = 0;
    // members convert in path order, so the second call is b.svg's
    const p = ports(async (r) => (++calls === 2 ? { identity: r.identity, status: 'unsupported' as const, fontHashes: [] } : painted(r)));
    const input = folder({ 'a.svg': SQUARE, 'b.svg': SQUARE });
    const { code, reply } = await packImport([input, ...flags(out)], p.ports);
    expect([code, messages(reply)]).toEqual([1, expect.stringMatching(/^b\.svg: /)]);
    expect(existsSync(out)).toBe(false);
    expect(p.dispose).toHaveBeenCalledOnce();
  });

  it('FR-LIB-004: more members than one witness session admits (129 > 128) are all converted through a second session', async () => {
    const out = fresh();
    const members = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`s${String(i).padStart(3, '0')}.svg`, SQUARE]));
    const p = ports();
    const { code, reply } = await packImport([folder(members), ...flags(out)], p.ports);
    expect(code, messages(reply)).toBe(0);
    expect((reply.result as unknown as { acceptedCount: number }).acceptedCount).toBe(129);
    expect(p.witness).toHaveBeenCalledTimes(2);
    expect(p.dispose).toHaveBeenCalledTimes(2);
  });

  it('FR-LIB-004: a witness that cannot start reports its own failure, peer-missing as exit 2', async () => {
    const out = fresh();
    const diagnostics = [{ code: 'FLX_CLI_IO', severity: 'error', path: '', message: 'Node SVG witness: peer-missing' }];
    const p = { witness: async () => ({ ok: false, error: { kind: 'peer-missing', diagnostics } }) } as unknown as PackImportPorts;
    const { code, reply } = await packImport([folder({ 'a.svg': SQUARE }), ...flags(out)], p);
    expect([code, messages(reply)]).toEqual([2, 'Node SVG witness: peer-missing']);
    expect(existsSync(out)).toBe(false);
  });
});

describe('pack-import output (FR-LIB-004)', () => {
  it('FR-LIB-004: a pack that does not load back is not renamed into place, and its temporary directory is removed', async () => {
    const parent = fresh();
    mkdirSync(parent);
    const out = join(parent, 'pack');
    const failed = await writePackDir(out, new Map([['index.json', new TextEncoder().encode('{"formatVersion":"1.0"}\n')]]));
    expect(failed).toMatch(/does not load/);
    expect(readdirSync(parent)).toEqual([]);
  });

  it('FR-LIB-004: the command needs one input and -o, --namespace, --version and --name', async () => {
    const outcomes: Outcome['exitCode'][] = [];
    for (const args of [
      [],
      ['a', 'b', ...flags(fresh())],
      ['a', '--namespace', 'n', '--version', '1.0.0', '--name', 'N'],
      ['a', '-o', fresh()],
      ['a', ...flags(fresh()).slice(0, 8), '--credits', 'c.json', '--notice-file', 'n.txt'],
      ['a', ...flags(fresh()).slice(0, 8), '--credits', 'c.json', '--upstream-sha256', 'f'.repeat(64)],
    ])
      outcomes.push((await packImport(args)).code);
    expect(outcomes).toEqual([2, 2, 2, 2, 2, 2]);
  });
});
