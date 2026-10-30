#!/usr/bin/env node
// Reproducible font-engine assets (M18.48, ADR-0051): the single recipe for the standalone WOFF2/Brotli codec and the
// verification of the pinned HarfBuzz subset module. Pins live in packages/format/assets/font-engine/manifest.json.
//
//   node scripts/fonts/build-font-engine.mjs fetch --sources <dir>      clone woff2 + brotli at the pinned revisions
//   node scripts/fonts/build-font-engine.mjs check --sources <dir>      rebuild the codec in a clean directory; compare
//   node scripts/fonts/build-font-engine.mjs harfbuzz --tarball <tgz>   verify npm integrity and the extracted module
//
// `check` needs `emcc` from emsdk 6.0.13 on PATH (source emsdk_env.sh). The font-engine workflow runs fetch and check
// (scripts/ci/font-engine-rebuild.mjs); check-font-engine-evidence.mjs holds the recorded run (M18.109).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../packages/format/assets/font-engine');
export const manifest = () => JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/** Compiler flags shared by every object and the link: size-optimized, assertion-free, build paths mapped away. */
const flags = (sources, build) => ['-Oz', '-DNDEBUG', `-ffile-prefix-map=${sources}=/src`, `-ffile-prefix-map=${build}=/build`];
const WOFF2_UNITS = ['font', 'glyph', 'normalize', 'table_tags', 'transform', 'variable_length', 'woff2_common', 'woff2_dec', 'woff2_enc', 'woff2_out'];
/** Standalone module: no filesystem or JS glue, 16 MiB initial and 128 MiB maximum memory, 1 MiB stack. */
const LINK = [
  '-sSTANDALONE_WASM',
  '-sFILESYSTEM=0',
  '-sINITIAL_MEMORY=16MB',
  '-sMAXIMUM_MEMORY=128MB',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sSTACK_SIZE=1MB',
  '--no-entry',
];

const codecAsset = (m) => m.assets.find((a) => a.file === 'woff2-codec.wasm');
const harfbuzzAsset = (m) => m.assets.find((a) => a.file === 'harfbuzz-subset.wasm');

/** The emcc version line must name the pinned release; another compiler cannot reproduce the hash. */
export function emscriptenVersion() {
  try {
    return /\) (\d+\.\d+\.\d+) \(/.exec(run('emcc', ['--version']).split('\n')[0] ?? '')?.[1];
  } catch {
    return undefined;
  }
}

/** Each pinned checkout under `sources` must be at its recorded revision. */
function checkRevisions(sources, pins) {
  for (const pin of pins) {
    const head = run('git', ['-C', join(sources, pin.name), 'rev-parse', 'HEAD']).trim();
    if (head !== pin.revision) throw new Error(`${pin.name} is at ${head}, expected ${pin.revision}`);
  }
}

/** Build the codec from pinned checkouts in a fresh directory and return its bytes. */
export function buildCodec(sources) {
  const m = manifest();
  const asset = codecAsset(m);
  const version = emscriptenVersion();
  if (version !== m.toolchain.emscripten) throw new Error(`emcc ${version ?? 'missing'}; the pinned toolchain is emsdk ${m.toolchain.emscripten}`);
  checkRevisions(sources, asset.sources);
  const build = mkdtempSync(join(tmpdir(), 'fluxion-font-engine-'));
  try {
    const obj = join(build, 'obj');
    mkdirSync(obj);
    writeFileSync(join(build, 'codec.cc'), readFileSync(join(ASSETS, asset.wrapper)));
    const f = flags(sources, build);
    const brotli = join(sources, 'brotli/c');
    for (const part of ['common', 'dec', 'enc'])
      for (const file of readdirSync(join(brotli, part))
        .filter((n) => n.endsWith('.c'))
        .sort())
        run('emcc', [...f, `-I${brotli}/include`, '-c', join(brotli, part, file), '-o', join(obj, `${part}-${basename(file, '.c')}.o`)]);
    const units = [...WOFF2_UNITS.map((u) => join(sources, 'woff2/src', `${u}.cc`)), join(build, 'codec.cc')];
    for (const unit of units)
      run('em++', [
        ...f,
        '-fno-exceptions',
        '-fno-rtti',
        '-std=c++11',
        `-I${sources}/woff2/include`,
        `-I${brotli}/include`,
        '-c',
        unit,
        '-o',
        join(obj, `${basename(unit, '.cc')}.o`),
      ]);
    const objects = readdirSync(obj)
      .sort()
      .map((n) => join(obj, n));
    run('em++', [...f, ...objects, '-o', join(build, 'woff2-codec.wasm'), ...LINK], { cwd: build });
    return readFileSync(join(build, 'woff2-codec.wasm'));
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
}

/** Verify the npm tarball's integrity and that its subset module is the committed asset. */
export function verifyHarfbuzz(tarball) {
  const asset = harfbuzzAsset(manifest());
  const bytes = readFileSync(tarball);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== asset.package.integrity) throw new Error(`tarball integrity ${integrity} is not ${asset.package.integrity}`);
  const out = mkdtempSync(join(tmpdir(), 'fluxion-harfbuzzjs-'));
  try {
    run('tar', ['-xzf', tarball, '-C', out, asset.package.path]);
    const module = readFileSync(join(out, asset.package.path));
    if (sha256(module) !== asset.sha256) throw new Error(`extracted module ${sha256(module)} is not ${asset.sha256}`);
    return true;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function fetchSources(sources) {
  mkdirSync(sources, { recursive: true });
  for (const pin of codecAsset(manifest()).sources) {
    run('git', ['clone', '--quiet', pin.url, join(sources, pin.name)]);
    run('git', ['-C', join(sources, pin.name), 'checkout', '--quiet', pin.revision]);
  }
}

function main(argv) {
  const [command, flag, value] = argv;
  if (command === 'fetch' && flag === '--sources') return fetchSources(value);
  if (command === 'check' && flag === '--sources') {
    const bytes = buildCodec(value);
    const expected = codecAsset(manifest()).sha256;
    console.log(`woff2-codec.wasm ${sha256(bytes)} (${bytes.length} bytes); committed ${expected}`);
    if (sha256(bytes) !== expected) process.exitCode = 1;
    return;
  }
  if (command === 'harfbuzz' && flag === '--tarball') return console.log(verifyHarfbuzz(value) ? 'harfbuzz-subset.wasm matches the pinned package' : '');
  console.error('usage: build-font-engine.mjs fetch|check --sources <dir> | harfbuzz --tarball <tgz>');
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
