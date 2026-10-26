import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { compareResults, diagnosticLines, resultProblems } from '../../scripts/tooling/compiler-parity.mjs';
import { compilerSnapshot } from '../../scripts/tooling/compiler-snapshot.mjs';

test('NFR-MNT-004: compiler parity rejects missing and changed outputs, statuses and diagnostics', () => {
  const good = { status: 0, diagnostics: [], files: { 'core/index.d.ts': 'a', 'core/index.d.ts.map': 'b' } };
  assert.deepEqual(compareResults(good, good), []);
  assert.ok(compareResults(good, { ...good, status: 1 }).length);
  assert.ok(compareResults(good, { ...good, diagnostics: ['error TS2322: wrong type'] }).length);
  assert.ok(compareResults(good, { ...good, files: { 'core/index.d.ts': 'a' } }).length);
  assert.ok(compareResults(good, { ...good, files: { ...good.files, 'extra.js': 'x' } }).length);
  assert.ok(compareResults(good, { ...good, files: { ...good.files, 'core/index.d.ts.map': 'changed' } }).length);
});
test('NFR-MNT-004: normalization removes only root paths, CRLF and ordering, preserving diagnostic text', () => {
  assert.deepEqual(diagnosticLines('/tmp/a/pkg/x.ts(1,2): error TS2322: wrong\r\n  detail\r\n', '/tmp/a'), [
    '<source>/pkg/x.ts(1,2): error TS2322: wrong\n  detail',
  ]);
  assert.notDeepEqual(diagnosticLines('error TS1: first', '/tmp/a'), diagnosticLines('error TS1: second', '/tmp/a'));
});

test('NFR-MNT-004: crashes, empty emissions and unrelated errors cannot qualify compiler probes', () => {
  const valid = { status: 0, diagnostics: [], files: { 'x.d.ts': 'hash' } };
  assert.deepEqual(resultProblems(valid, false), []);
  assert.ok(resultProblems({ ...valid, status: null }, true).length);
  assert.ok(resultProblems({ ...valid, files: {} }, false).length);
  assert.ok(resultProblems(valid, true).length);
  const probe = { ...valid, status: 2, diagnostics: ['TS2322', 'TS2375', 'TS2307'].map((code) => `probe.ts(1,1): error ${code}: expected`) };
  assert.deepEqual(resultProblems(probe, true, 'probe.ts'), []);
  assert.ok(resultProblems({ ...probe, diagnostics: ['other.ts(1,1): error TS2322: unrelated'] }, true, 'probe.ts').length);
});

test('NFR-MNT-004: compiler snapshots isolate source and workspace links, and reject omitted output directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'fluxion-compiler-probe-'));
  const repo = join(root, 'repo');
  const put = (file, value) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  try {
    put('tools/gen/workspaces.json', {
      workspaces: [
        { name: '@fluxion/a', dir: 'units/a' },
        { name: '@fluxion/b', dir: 'units/b' },
      ],
    });
    put('tsconfig.json', { files: [], references: ['units/a', 'units/b', 'e2e'].map((path) => ({ path })) });
    for (const dir of ['units/a', 'units/b', 'e2e']) put(`${dir}/tsconfig.json`, { compilerOptions: { outDir: '.tsbuild' } });
    put('units/a/src/value.ts', 'export const value = 1;');
    for (const args of [
      ['init', '-q'],
      ['add', '.'],
    ])
      assert.equal(
        spawnSync('git', args, {
          cwd: repo,
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') || key === 'GIT_EXEC_PATH')),
        }).status,
        0,
      );
    mkdirSync(join(repo, 'node_modules'));
    mkdirSync(join(repo, 'units/a/node_modules/@fluxion'), { recursive: true });
    symlinkSync(join(repo, 'units/b'), join(repo, 'units/a/node_modules/@fluxion/b'), 'junction');
    const copy = join(root, 'copy');
    assert.deepEqual(compilerSnapshot(repo, copy), ['units/a', 'units/b', 'e2e']);
    assert.equal(realpathSync(join(copy, 'units/a/node_modules/@fluxion/b')), realpathSync(join(copy, 'units/b')));
    writeFileSync(join(copy, 'units/a/src/value.ts'), 'changed only in snapshot');
    assert.equal(readFileSync(join(repo, 'units/a/src/value.ts'), 'utf8'), 'export const value = 1;');
    const previousIndex = process.env.GIT_INDEX_FILE;
    try {
      process.env.GIT_INDEX_FILE = join(root, 'foreign-index');
      assert.deepEqual(compilerSnapshot(repo, join(root, 'hook-copy')), ['units/a', 'units/b', 'e2e']);
    } finally {
      if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = previousIndex;
    }

    put('units/a/tsconfig.json', { compilerOptions: { outDir: 'other-output' } });
    assert.throws(() => compilerSnapshot(repo, join(root, 'wrong-output')), /Unsupported output directory/);
    put('units/a/tsconfig.json', { compilerOptions: { outDir: '.tsbuild' } });
    put('tsconfig.json', { files: [], references: [{ path: 'units/a' }] });
    assert.throws(() => compilerSnapshot(repo, join(root, 'omitted-project')), /Solution inventory changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NFR-MNT-004: path normalization preserves quoted diagnostic values', () => {
  const root = String.raw`C:\snapshot`;
  const original = String.raw`C:\snapshot\pkg\x.ts(1,1): error TS2322: Type "a\b" is not assignable`;
  const normalized = diagnosticLines(original, root);
  assert.deepEqual(normalized, [String.raw`<source>/pkg/x.ts(1,1): error TS2322: Type "a\b" is not assignable`]);
  assert.notDeepEqual(normalized, diagnosticLines(original.replace(String.raw`"a\b"`, '"a/b"'), root));
});
