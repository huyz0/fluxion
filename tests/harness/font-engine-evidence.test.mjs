// NFR-SEC-001 (M18.109, cp11 F6): the committed woff2-codec.wasm is backed by a recorded font-engine workflow run that rebuilt it
// with the pinned toolchain from the pinned checkouts, re-read from GitHub (here: a runs fixture), on a commit whose codec bytes,
// hash and pins are still today's.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const MANIFEST = 'packages/format/assets/font-engine/manifest.json';
const CODEC = 'packages/format/assets/font-engine/woff2-codec.wasm';
const run = (id, headSha, over = {}) => ({
  databaseId: id,
  workflowName: 'font-engine',
  headSha,
  conclusion: 'success',
  jobs: [{ name: 'rebuild', conclusion: 'success' }],
  ...over,
});

let sb;
let base;
let codecSha;
const commit = (subject) => {
  sb.git('add', '-A');
  sb.git('commit', '-q', '--no-verify', '-m', subject);
  return sb.git('rev-parse', 'HEAD').stdout.trim();
};
const check = (record, runs, extra = []) => {
  sb.write('ev.json', JSON.stringify(record));
  sb.write('runs.json', JSON.stringify(runs));
  return sb.node('scripts/gates/check-font-engine-evidence.mjs', ['--file', sb.path('ev.json'), '--runs-file', sb.path('runs.json'), ...extra]);
};
const record = (sha, over = {}) => ({ run: 7, sha, codecSha256: codecSha, recordedAt: '2026-10-27T00:00:00Z', ...over });
/** Reset the sandbox to `base`, so each case starts from the rebuilt commit. */
const reset = () => sb.git('reset', '-q', '--hard', base);

describe('check-font-engine-evidence (NFR-SEC-001)', () => {
  before(() => {
    sb = sandbox(['scripts', 'packages/format/assets/font-engine', '.github/workflows/font-engine.yml', '.node-version'], { git: true });
    base = sb.git('rev-parse', 'HEAD').stdout.trim();
    codecSha = JSON.parse(sb.read(MANIFEST)).assets.find((a) => a.file === 'woff2-codec.wasm').sha256;
  });
  after(() => sb.cleanup());

  it('NFR-SEC-001: passes a green rebuild run of a commit whose codec and pins are today’s, also after later unrelated commits', () => {
    reset();
    const r = check(record(base), [run(7, base)]);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /run 7 rebuilt woff2-codec\.wasm/);
    sb.write('docs/later.md', 'later\n');
    commit('M9.2: docs(harness): later');
    assert.equal(check(record(base), [run(7, base)]).status, 0, 'unrelated commits keep the evidence');
  });

  it('NFR-SEC-001: refuses another workflow, a failed or missing rebuild job, another commit and an unreadable run', () => {
    reset();
    const cases = [
      [run(7, base, { workflowName: 'nightly' }), /is workflow nightly, not font-engine/],
      [run(7, base, { jobs: [{ name: 'rebuild', conclusion: 'failure' }] }), /job rebuild failure/],
      [run(7, base, { jobs: [] }), /job rebuild missing/],
      [run(7, '0'.repeat(40)), /ran 0000000, not/],
      [{ databaseId: 7, error: 'HTTP 502' }, /reading run 7 failed: HTTP 502/],
    ];
    for (const [r, message] of cases) {
      const res = check(record(base), [r]);
      assert.equal(res.status, 1, out(res));
      assert.match(res.stderr, message);
    }
    const wrongHash = check(record(base, { codecSha256: 'f'.repeat(64) }), [run(7, base)]);
    assert.equal(wrongHash.status, 1, out(wrongHash));
    assert.match(wrongHash.stderr, /the record names codec f{64}/);
  });

  it('NFR-SEC-001: a codec, hash or pin changed after the rebuild needs a new rebuild', () => {
    reset();
    const bytes = sb.read(CODEC);
    sb.write(CODEC, `${bytes}x`);
    commit('M9.3: fix(format): codec bytes only');
    const bytesOnly = check(record(base), [run(7, base)]);
    assert.equal(bytesOnly.status, 1, out(bytesOnly));
    assert.match(bytesOnly.stderr, /woff2-codec\.wasm bytes differ from the ones the run rebuilt/);
    reset();
    sb.edit(MANIFEST, (t) => t.replace(codecSha, 'e'.repeat(64)));
    commit('M9.4: fix(format): codec hash');
    const hash = check(record(base), [run(7, base)]);
    assert.equal(hash.status, 1, out(hash));
    assert.match(hash.stderr, /the committed codec hash changed since the rebuild/);
    reset();
    sb.edit(MANIFEST, (t) => t.replace('"6.0.13"', '"6.0.14"'));
    commit('M9.5: chore(format): toolchain bump');
    const pins = check(record(base), [run(7, base)]);
    assert.equal(pins.status, 1, out(pins));
    assert.match(pins.stderr, /pins changed since the rebuild/);
  });

  it('NFR-SEC-001: a changed compare, flags or wrapper source after the rebuild, or a run of a commit off this branch, is no evidence', () => {
    for (const [path, message] of [
      ['scripts/fonts/build-font-engine.mjs', /build-font-engine\.mjs changed since the rebuild/],
      ['scripts/ci/font-engine-rebuild.mjs', /font-engine-rebuild\.mjs changed since the rebuild/],
      ['packages/format/assets/font-engine/codec.cc', /codec\.cc changed since the rebuild/],
    ]) {
      reset();
      sb.edit(path, (t) => `${t}\n// edited\n`);
      commit(`M9.7: fix(format): edit ${path}`);
      const r = check(record(base), [run(7, base)]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, message);
    }
    reset();
    sb.git('checkout', '-q', '-b', 'side');
    sb.write('docs/side.md', 'side\n');
    const side = commit('M9.8: docs(harness): a dispatched branch');
    sb.git('checkout', '-q', 'main');
    reset();
    const off = check(record(side), [run(7, side)]);
    assert.equal(off.status, 1, out(off));
    assert.match(off.stderr, /is not an ancestor of HEAD/);
  });

  it('NFR-SEC-001: a workflow that only names the rebuild in a comment is no rebuild', () => {
    reset();
    sb.edit('.github/workflows/font-engine.yml', (t) => t.replace(/^(\s*)- run: node scripts\/ci\/font-engine-rebuild\.mjs.*$/m, '$1- run: echo skipped'));
    const sha = commit('M9.6: ci(ci): skip the rebuild');
    const r = check(record(sha), [run(7, sha)]);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /does not run scripts\/ci\/font-engine-rebuild\.mjs/);
  });

  it('NFR-SEC-001: --record writes the run, its commit and the codec hash; a missing record fails with how to make one', () => {
    reset();
    sb.write('runs.json', JSON.stringify([run(9, base)]));
    const rec = sb.node('scripts/gates/check-font-engine-evidence.mjs', ['--record', '9', '--file', sb.path('rec.json'), '--runs-file', sb.path('runs.json')]);
    assert.equal(rec.status, 0, out(rec));
    assert.deepEqual({ ...JSON.parse(sb.read('rec.json')), recordedAt: undefined }, { run: 9, sha: base, codecSha256: codecSha, recordedAt: undefined });
    sb.write('runs.json', JSON.stringify([run(9, base, { jobs: [{ name: 'rebuild', conclusion: 'cancelled' }] })]));
    const red = sb.node('scripts/gates/check-font-engine-evidence.mjs', ['--record', '9', '--file', sb.path('red.json'), '--runs-file', sb.path('runs.json')]);
    assert.equal(red.status, 1, out(red));
    const missing = sb.node('scripts/gates/check-font-engine-evidence.mjs', ['--file', sb.path('none.json'), '--runs-file', sb.path('runs.json')]);
    assert.equal(missing.status, 1, out(missing));
    assert.match(missing.stderr, /--record <run-id>/);
  });
});
