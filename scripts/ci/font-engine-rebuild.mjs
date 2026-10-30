#!/usr/bin/env node
// The font-engine workflow's rebuild (M18.109, ADR-0051): install the pinned emsdk release, clone woff2 and Brotli at their pinned
// revisions, rebuild woff2-codec.wasm in a clean directory and compare it with the committed bytes. Exits non-zero on any
// mismatch, including an emcc other than the pinned release (build-font-engine.mjs checks the version itself).
//   node scripts/ci/font-engine-rebuild.mjs <work-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { manifest } from '../fonts/build-font-engine.mjs';

const work = resolve(process.argv[2] ?? 'font-engine-work');
const { emscripten, emsdkRevision } = manifest().toolchain;
const emsdk = join(work, 'emsdk');
const sources = join(work, 'sources');
const build = resolve(import.meta.dirname, '../fonts/build-font-engine.mjs');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

mkdirSync(work, { recursive: true });
// emsdk at its recorded commit, not by tag alone (M18.208): the installer at that commit maps the release to its prebuilt
// toolchain, and build-font-engine.mjs check refuses an emcc at another emscripten revision
sh('git', ['init', '--quiet', emsdk]);
sh('git', ['-C', emsdk, 'fetch', '--quiet', '--depth', '1', 'https://github.com/emscripten-core/emsdk.git', emsdkRevision]);
sh('git', ['-C', emsdk, 'checkout', '--quiet', 'FETCH_HEAD']);
const head = execFileSync('git', ['-C', emsdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== emsdkRevision) throw new Error(`emsdk is at ${head}, expected ${emsdkRevision}`);
sh(join(emsdk, 'emsdk'), ['install', emscripten], { cwd: emsdk });
sh(join(emsdk, 'emsdk'), ['activate', emscripten], { cwd: emsdk });
sh(process.execPath, [build, 'fetch', '--sources', sources]);
// emcc is on PATH only inside a shell that sourced emsdk_env.sh
sh('bash', ['-c', 'source "$1/emsdk_env.sh" >/dev/null && node "$2" check --sources "$3"', 'rebuild', emsdk, build, sources]);
