// FR-AST-003 NFR-SEC-002 NFR-LIC-001: pinned font-engine assets are reproducible, licensed, bounded and run under a
// worker CSP that allows WASM but never JavaScript evaluation (M18.48, ADR-0051).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import {
  ASSETS,
  buildCodec,
  emccIdentity,
  emscriptenVersion,
  manifest,
  sha256,
  toolchainProblem,
  verifyHarfbuzz,
} from '../../scripts/fonts/build-font-engine.mjs';
import { REPO } from './helpers.mjs';

const assetBytes = (file) => readFileSync(join(ASSETS, file));
const NOTICE_HOLDERS = {
  'licenses/woff2.txt': 'by the WOFF2 Authors',
  'licenses/brotli.txt': 'by the Brotli Authors',
  'licenses/harfbuzz.txt': 'HarfBuzz is licensed under the so-called "Old MIT" license',
  'licenses/harfbuzzjs.txt': 'The harfbuzzjs project authors',
  'licenses/emscripten.txt': 'Emscripten authors',
  'licenses/musl.txt': 'Rich Felker',
};

test('FR-AST-003 NFR-LIC-001: pinned font binaries rebuild identically and retain notices', () => {
  const m = manifest();
  assert.equal(m.toolchain.emscripten, '6.0.13');
  for (const asset of m.assets) {
    const bytes = assetBytes(asset.file);
    assert.equal(sha256(bytes), asset.sha256, `${asset.file} hash`);
    assert.equal(bytes.length, asset.bytes, `${asset.file} size`);
    assert.equal(asset.license, 'MIT');
    assert.ok(asset.notices.length >= 2, `${asset.file} retains its own and its dependency's notices`);
    for (const notice of asset.notices) {
      const text = readFileSync(join(ASSETS, notice), 'utf8');
      assert.match(text, /Permission is hereby granted/, notice);
      assert.ok(text.includes(NOTICE_HOLDERS[notice]), `${notice} names its copyright holders`);
    }
    for (const pin of asset.sources) assert.match(pin.revision, /^[0-9a-f]{40}$/, `${pin.name} is pinned to a full revision`);
    const module = new WebAssembly.Module(bytes);
    assert.deepEqual(
      WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`),
      asset.imports,
      `${asset.file} imports nothing beyond the recorded host hooks`,
    );
  }
  const codec = m.assets.find((a) => a.file === 'woff2-codec.wasm');
  // two clean-directory builds were recorded; with the pinned toolchain and checkouts present, rebuild again now
  assert.ok(codec.reproductions.length >= 2 && codec.reproductions.every((r) => r.sha256 === codec.sha256));
  assert.ok(codec.runtime?.emscripten && codec.runtime?.llvm, 'the linked Emscripten runtime records its licence terms');
  const sources = process.env.FLUXION_FONT_ENGINE_SOURCES;
  // a requested rebuild without the pinned toolchain fails rather than passing as skipped
  if (sources) assert.equal(emscriptenVersion(), m.toolchain.emscripten, 'FLUXION_FONT_ENGINE_SOURCES is set: source emsdk 6.0.13 first');
  if (sources) assert.equal(sha256(buildCodec(sources)), codec.sha256, 'fresh rebuild');
  else console.log('# font engine: rebuild skipped (set FLUXION_FONT_ENGINE_SOURCES and source emsdk 6.0.13); recorded reproductions checked');
  const tarball = process.env.FLUXION_HARFBUZZJS_TARBALL;
  if (tarball) assert.ok(verifyHarfbuzz(tarball));
  else assert.match(m.assets.find((a) => a.file === 'harfbuzz-subset.wasm').package.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
});

test('NFR-SEC-001: the rebuild refuses an emcc of the pinned release at another emscripten revision, and pins emsdk by commit (M18.208)', () => {
  const { toolchain } = manifest();
  assert.match(toolchain.emscriptenRevision, /^[0-9a-f]{40}$/);
  assert.match(toolchain.emsdkRevision, /^[0-9a-f]{40}$/);
  const line = (version, revision) => `emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) ${version} (${revision})`;
  const pinned = line(toolchain.emscripten, toolchain.emscriptenRevision);
  assert.deepEqual(emccIdentity(pinned), { version: toolchain.emscripten, revision: toolchain.emscriptenRevision });
  assert.equal(toolchainProblem(pinned, toolchain), undefined);
  // the same release built from another emscripten commit
  const other = line(toolchain.emscripten, 'f'.repeat(40));
  assert.match(
    toolchainProblem(other, toolchain) ?? '',
    new RegExp(`emcc ${toolchain.emscripten} is at emscripten revision f{40}; the pinned toolchain is ${toolchain.emscriptenRevision}`),
  );
  // a line without a full revision, another release, and no emcc at all
  assert.match(toolchainProblem(`emcc (x) ${toolchain.emscripten} (e13ee98)`, toolchain) ?? '', /revision unknown/);
  assert.match(toolchainProblem(line('6.0.12', toolchain.emscriptenRevision), toolchain) ?? '', /emcc 6\.0\.12; the pinned toolchain is emsdk 6\.0\.13/);
  assert.match(toolchainProblem(undefined, toolchain) ?? '', /emcc missing/);
  // the workflow's rebuild checks emsdk out at the recorded commit and confirms it, never by tag alone
  const rebuild = readFileSync(join(REPO, 'scripts/ci/font-engine-rebuild.mjs'), 'utf8');
  assert.match(rebuild, /'fetch', '--quiet', '--depth', '1', 'https:\/\/github\.com\/emscripten-core\/emsdk\.git', emsdkRevision\]/);
  assert.match(rebuild, /if \(head !== emsdkRevision\) throw/);
  assert.doesNotMatch(rebuild, /'--branch'/);
});

test('FR-AST-003 NFR-SEC-002: malformed fonts and dirty output buffers remain bounded and deterministic', () => {
  const out = execFileSync(
    process.execPath,
    ['--disallow-code-generation-from-strings', join(REPO, 'scripts/fonts/probe-font-engine.mjs'), ASSETS, join(REPO, 'fixtures/fonts/roboto-400.woff2')],
    { encoding: 'utf8' },
  );
  const r = JSON.parse(out);
  assert.equal(r.codegenBlocked, true, 'the engines run with JavaScript string code generation forbidden');
  // a real font decodes, subsets and re-encodes; every dirty destination (0x00, 0xa5, 0xff, 0x5a) yields the same bytes, so padding is zeroed
  assert.ok(r.pipeline.sfntBytes > r.pipeline.subsetBytes && r.pipeline.subsetBytes > 0);
  assert.equal(r.pipeline.woff2.length, 4, 'four dirty destinations');
  assert.equal(new Set(r.pipeline.woff2.map((e) => e.sha256)).size, 1, 'the bytes do not depend on what the destination held');
  assert.ok(r.pipeline.woff2.every((e) => e.size > 0 && e.canary));
  assert.ok(r.pipeline.redecodedSubsetSha256Matches);
  // too-small destinations are refused without writing past them
  assert.deepEqual(r.bounds, { encodeTooSmall: { size: 0, canary: true }, decodeTooSmall: { size: 0, canary: true } });
  // HarfBuzz refuses garbage and empty fonts and keeps its fixed 65 MiB (1040-page) memory
  assert.deepEqual(r.harfbuzz, { pages: 1040, garbage: true, empty: true, pagesAfter: 1040 });
  // a declared size between the 5 MiB host cap and 2 GiB is refused by the cap alone: without it the same bytes decode to the real font
  const o = r.overCap;
  assert.ok(o.declared > 5 * 1024 * 1024 && o.declared < 2 ** 31, `declared ${o.declared} lies between the cap and 2 GiB`);
  assert.deepEqual({ size: o.cappedSize, byCap: o.refusedByCap }, { size: 0, byCap: true });
  assert.equal(o.uncappedSize, r.pipeline.sfntBytes);
  assert.ok(o.uncappedSha256Matches, 'the uncapped decode is the same font');
  const m = r.malformed;
  assert.equal(m.refused + m.decoded + m.traps, m.cases);
  assert.equal(m.traps, 0, 'no malformed input traps the codec');
  assert.ok(m.refused > m.cases / 2, 'most corrupted inputs are refused');
  assert.ok(m.canariesIntact, 'no decode writes past its destination');
  assert.ok(m.maxSize <= r.pipeline.sfntBytes && m.maxSize <= 5 * 1024 * 1024);
  // the codec's memory stays below the maximum its module declares (2048 pages = 128 MiB)
  assert.equal(r.codecMaxPages, 2048);
  assert.ok(m.maxMemory < r.codecMaxPages * 65536, `peak ${m.maxMemory} bytes is below the module maximum`);
});

const WORKER = `
const report = (r) => postMessage(r);
(async () => {
  const r = { wasm: false, wasmError: '', evalBlocked: false };
  try {
    const bytes = await (await fetch('/woff2-codec.wasm')).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: { emscripten_notify_memory_growth: () => {} },
      wasi_snapshot_preview1: { proc_exit: () => { throw new Error('exit'); } },
    });
    instance.exports._initialize();
    r.wasm = typeof instance.exports.woff2_encode === 'function';
  } catch (e) { r.wasmError = String(e && e.name); }
  try { new Function('return 1')(); } catch (e) { r.evalBlocked = e instanceof EvalError; }
  report(r);
})();
`;
const PAGE = `<!doctype html><script>
const run = (url) => new Promise((resolve) => { const w = new Worker(url); w.onmessage = (e) => resolve(e.data); w.onerror = (e) => resolve({ error: e.message }); });
window.results = Promise.all([run('/worker-wasm.js'), run('/worker-strict.js')]);
</script>`;

test('NFR-SEC-002: font workers allow WASM while blocking JavaScript evaluation', async () => {
  const codec = assetBytes('woff2-codec.wasm');
  const csp = {
    '/worker-wasm.js': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
    '/worker-strict.js': "default-src 'none'; script-src 'self'; connect-src 'self'",
  };
  const server = createServer((req, res) => {
    if (req.url === '/')
      res
        .writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; worker-src 'self'" })
        .end(PAGE);
    else if (csp[req.url]) res.writeHead(200, { 'content-type': 'text/javascript', 'content-security-policy': csp[req.url] }).end(WORKER);
    else if (req.url === '/woff2-codec.wasm') res.writeHead(200, { 'content-type': 'application/wasm' }).end(codec);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const [allowed, strict] = await page.evaluate(() => window.results);
    assert.deepEqual(allowed, { wasm: true, wasmError: '', evalBlocked: true }, 'wasm-unsafe-eval runs the engine; Function stays blocked');
    assert.equal(strict.wasm, false, 'without wasm-unsafe-eval the engine cannot compile');
    assert.equal(strict.wasmError, 'CompileError');
    assert.equal(strict.evalBlocked, true);
  } finally {
    await browser.close();
    server.close();
  }
});
