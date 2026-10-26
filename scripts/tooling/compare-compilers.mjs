#!/usr/bin/env node
// Explicit opt-in qualification, never a substitute for the authoritative TS7 gate.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { compareResults, diagnosticLines, emittedFiles, resultProblems } from './compiler-parity.mjs';
import { compilerSnapshot } from './compiler-snapshot.mjs';

const repo = process.cwd();
const require = createRequire(join(repo, 'package.json'));
const ts7 = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
const tsrs = join(dirname(require.resolve('tsrs/package.json')), 'bin/tsrs');
mkdirSync(resolve(repo, '.harness/tmp'), { recursive: true });
const output = mkdtempSync(resolve(repo, '.harness/tmp/compiler-parity-'));
const copies = Object.fromEntries(['ts7', 'tsrs'].map((name) => [name, join(output, name)]));
const directories = compilerSnapshot(repo, copies.ts7);
compilerSnapshot(repo, copies.tsrs);
if (readFileSync(`${copies.ts7}-source-inventory.json`, 'utf8') !== readFileSync(`${copies.tsrs}-source-inventory.json`, 'utf8'))
  throw new Error('Source changed while taking compiler snapshots');
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TSRS_')));
const results = [];
const failures = [];
function runCompiler(label, name, compiler, force) {
  const start = performance.now();
  const run = spawnSync(process.execPath, [compiler, '-b', ...(force ? ['--force'] : []), '--pretty', 'false'], {
    cwd: copies[name],
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  const stream = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`;
  writeFileSync(join(output, `${label}-${name}.log`), stream);
  return {
    status: run.status,
    signal: run.signal,
    ms: performance.now() - start,
    diagnostics: diagnosticLines(stream, copies[name]),
    files: emittedFiles(copies[name], directories),
  };
}

function check(label, force, expectedFailure = false, probe = null) {
  const pair = {};
  for (const [name, compiler] of [
    ['ts7', ts7],
    ['tsrs', tsrs],
  ]) {
    pair[name] = runCompiler(label, name, compiler, force);
    failures.push(...resultProblems(pair[name], expectedFailure, probe).map((message) => `${label}/${name}: ${message}`));
  }
  const mismatch = compareResults(pair.ts7, pair.tsrs);
  failures.push(...mismatch.map((message) => `${label}: ${message}`));
  results.push({ label, ...pair, differences: mismatch });
  console.log(
    `${label}: ${mismatch.length ? 'DIFFERENT' : 'equal'}; TS7=${pair.ts7.status}, tsrs=${pair.tsrs.status}; ${Object.keys(pair.ts7.files).length} outputs`,
  );
  writeFileSync(join(output, 'results.json'), `${JSON.stringify({ results, failures }, null, 2)}\n`);
}
check('clean', true);
check('warm', false);
for (const name of ['ts7', 'tsrs'])
  failures.push(...compareResults(results[0][name], results[1][name]).map((message) => `${name}/warm versus clean: ${message}`));
const apiFile = 'packages/geometry/src/vec2.ts';
const original = readFileSync(join(copies.ts7, apiFile), 'utf8');
if (!original.includes('readonly x: number;')) throw new Error('Incremental API probe target changed; update the reviewed probe');
for (const copy of Object.values(copies)) writeFileSync(join(copy, apiFile), original.replace('readonly x: number;', 'readonly x: string;'));
check('incremental-api-error', false, true);
for (const copy of Object.values(copies)) writeFileSync(join(copy, apiFile), original);
check('incremental-api-restored', false);
for (const name of ['ts7', 'tsrs']) {
  if (!results[2][name].diagnostics.some((line) => /packages\/(core|render|layout|routing)\//.test(line)))
    failures.push(`${name}: API mutation did not exercise a referenced consumer`);
  failures.push(...compareResults(results[0][name], results[3][name]).map((message) => `${name}/restored API versus clean: ${message}`));
}
for (const [name, folder] of [
  ['pure', 'packages/core/src'],
  ['browser', 'packages/render/src'],
  ['app', 'apps/studio/src'],
  ['e2e', 'e2e'],
]) {
  const relative = `${folder}/compiler-parity-probe.ts`;
  if (Object.values(copies).some((copy) => existsSync(join(copy, relative)))) throw new Error(`Probe path already exists: ${relative}`);
  for (const copy of Object.values(copies))
    writeFileSync(
      join(copy, relative),
      'export const compilerParityNumber: number = "wrong";\nexport const compilerParityOptional: { x?: number } = { x: undefined };\nimport { compilerParityMissing } from "./compiler-parity-module-does-not-exist.js";\nexport { compilerParityMissing };\n',
    );
  check(`error-${name}`, false, true, relative);
  for (const copy of Object.values(copies)) rmSync(join(copy, relative));
  check(`restored-${name}`, false);
}
writeFileSync(join(output, 'results.json'), `${JSON.stringify({ results, failures }, null, 2)}\n`);
console.log(`compiler-parity: ${failures.length ? 'FAIL' : 'PASS'}; evidence ${output}`);
process.exitCode = failures.length ? 1 : 0;
