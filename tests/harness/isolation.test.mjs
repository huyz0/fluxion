// NFR-DX-002: the harness suite leaves the working tree untouched, so the concurrent ladder has no
// writer racing its readers (M1.36, M1 cp3 F1).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

let sb;
const isolation = (script) => {
  sb.write('probe.mjs', script);
  return sb.node('scripts/gates/check-suite-isolation.mjs', ['--dir', sb.dir, '--cmd', sb.path('probe.mjs')]);
};

describe('check-suite-isolation (NFR-DX-002)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts']);
    sb.write('packages/core/dist/index.js', 'export {};\n');
  });
  afterEach(() => sb.cleanup());

  it('passes when the run writes nothing', () => {
    const r = isolation("console.log('read only');\n");
    assert.equal(r.status, 0, out(r));
  });

  it('fails naming a file the run created, rewrote or deleted, including ignored build output', () => {
    const r = isolation(
      "import { rmSync, writeFileSync } from 'node:fs';\nwriteFileSync('packages/core/dist/index.js', 'changed');\nwriteFileSync('new.txt', 'x');\nrmSync('probe.mjs');\n",
    );
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /the suite rewrote packages\/core\/dist\/index\.js/);
    assert.match(r.stderr, /the suite created new\.txt/);
    assert.match(r.stderr, /the suite deleted probe\.mjs/);
  });

  it('fails when the run itself fails', () => {
    const r = isolation('process.exit(3);\n');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /the suite failed \(exit 3\)/);
  });
});
