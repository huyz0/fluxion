// NFR-MNT-005: revision provenance and dirty-input checks cannot be replaced by a cached receipt.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { out } from './helpers.mjs';
import { mutationFixture } from './mutation-fixture.mjs';

function probe(sb, body) {
  sb.write('reports/probe.mjs', `import { mutationProvenance } from '../scripts/gates/mutation-evidence-provenance.mjs';\n${body}`);
  return sb.node('reports/probe.mjs');
}
describe('mutation evidence gate (NFR-MNT-005)', () => {
  it('accepts current code and later bookkeeping, rejects dirty code and untracked inputs', () => {
    const sb = mutationFixture();
    try {
      const sha = sb.git('rev-parse', 'HEAD').stdout.trim();
      const call = () => probe(sb, `mutationProvenance(${JSON.stringify(sha)}, 'M18');`);
      assert.equal(call().status, 0, out(call()));
      sb.write('.harness/state.json', '{}');
      assert.equal(call().status, 0, out(call()));
      sb.git('add', '.');
      sb.git('commit', '-qm', 'bookkeeping');
      assert.equal(call().status, 0, out(call()));
      sb.write('packages/core/src/value.ts', 'false');
      assert.notEqual(call().status, 0);
      sb.git('restore', 'packages/core/src/value.ts');
      sb.write('unknown.ts', 'true');
      assert.notEqual(call().status, 0);
    } finally {
      sb.cleanup();
    }
  });
  it('rejects stale code even with an older final review and rejects a future or unrelated revision', () => {
    const sb = mutationFixture();
    try {
      const sha = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('.harness/reviews/milestone-M18-final.json', JSON.stringify({ range: `${sha}..${sha}` }));
      sb.write('packages/core/src/value.ts', 'false');
      sb.git('add', '.');
      sb.git('commit', '-qm', 'new code');
      assert.notEqual(probe(sb, `mutationProvenance('${sha}', 'M18');`).status, 0);
      assert.notEqual(probe(sb, `mutationProvenance('${'f'.repeat(40)}', 'M18');`).status, 0);
      const head = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('.harness/reviews/milestone-M18-final.json', JSON.stringify({ range: `x..${'e'.repeat(40)}` }));
      assert.notEqual(probe(sb, `mutationProvenance('${head}', 'M18');`).status, 0);
    } finally {
      sb.cleanup();
    }
  });
});
