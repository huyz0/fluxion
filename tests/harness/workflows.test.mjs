// NFR-SEC-005: workflows lint clean with actionlint and zizmor; broken workflows fail the gate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const info = spawnSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf8' });
const dockerLinux = !info.error && info.status === 0 && info.stdout.trim() === 'linux';
const needDocker = { skip: dockerLinux ? false : 'no Linux Docker engine' };

const GOOD = `name: ok
on: [push]
permissions: {}
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`;

function lint(workflows, args = []) {
  const sb = sandbox(['scripts']);
  try {
    for (const [name, text] of Object.entries(workflows)) sb.write(`.github/workflows/${name}`, text);
    return sb.node('scripts/gates/check-workflows.mjs', ['--dir', sb.dir, ...args]);
  } finally {
    sb.cleanup();
  }
}

describe('check-workflows (NFR-SEC-005)', () => {
  it('passes on the real workflows', needDocker, () => {
    const r = spawnSync(process.execPath, ['scripts/gates/check-workflows.mjs', '--require-docker'], { encoding: 'utf8' });
    assert.equal(r.status, 0, out(r));
  });

  it('passes a minimal clean workflow', needDocker, () => {
    const r = lint({ 'ok.yml': GOOD });
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /actionlint: 0 findings[\s\S]*zizmor: 0 findings/);
  });

  it('fails an actionlint error (unknown runner label / bad expression)', needDocker, () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression under test
    const r = lint({ 'bad.yml': GOOD.replace('echo ok', 'echo ${{ github.nope( }}') });
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /actionlint:[\s\S]*bad\.yml:\d+:\d+/); // a real finding, not a setup error
  });

  it('fails a zizmor finding (unpinned action, template injection)', needDocker, () => {
    const risky = `${GOOD.replace('permissions: {}\n', '')}      - uses: actions/checkout@v4\n      - run: echo "\${{ github.event.issue.title }}"\n`;
    const r = lint({ 'risky.yml': risky.replace('on: [push]', 'on: [issues]') });
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /zizmor \(exit \d+, findings [1-9]\d*\)/); // counted findings, not a setup error
  });

  it('skips without failing when Docker is missing, unless --require-docker', () => {
    const sb = sandbox(['scripts']);
    try {
      sb.write('.github/workflows/ok.yml', GOOD);
      const env = { ...process.env, PATH: '' };
      const soft = sb.node('scripts/gates/check-workflows.mjs', ['--dir', sb.dir], { env });
      assert.equal(soft.status, 0, out(soft));
      assert.match(soft.stdout, /SKIP — Docker not available/);
      const hard = sb.node('scripts/gates/check-workflows.mjs', ['--dir', sb.dir, '--require-docker'], { env });
      assert.equal(hard.status, 1, out(hard));
    } finally {
      sb.cleanup();
    }
  });
});
