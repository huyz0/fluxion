// NFR-DX-003 (M0.25): the human kits for M0.13–M0.15 work without a CLI and are safe.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkDryRuns, checkReviewerSmoke } from '../../scripts/gates/milestone-checks.mjs';
import { cleanEnv, out, REPO, sandbox } from './helpers.mjs';

describe('toy gate (M0.14/M0.15 kit)', () => {
  it('success mode goes green only once done.txt says done', () => {
    const sb = sandbox(['scripts']);
    try {
      assert.equal(sb.node('scripts/harness/kits/toy-gate.mjs', ['success']).status, 1);
      sb.write('.harness/tmp/toy/done.txt', 'done\n');
      const r = sb.node('scripts/harness/kits/toy-gate.mjs', ['success']);
      assert.equal(r.status, 0, out(r));
      assert.match(r.stdout, /GATE toy-success: 1\/1/);
    } finally {
      sb.cleanup();
    }
  });

  it('impossible mode stays red for plausible attempts', () => {
    const sb = sandbox(['scripts']);
    try {
      for (const attempt of ['done', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '']) {
        sb.write('.harness/tmp/toy/proof.txt', attempt);
        assert.equal(sb.node('scripts/harness/kits/toy-gate.mjs', ['impossible']).status, 1, attempt);
      }
    } finally {
      sb.cleanup();
    }
  });
});

describe('dry-runs template (M0.14/M0.15)', () => {
  it('keeps the dry-runs leg red while unfilled', () => {
    const r = checkDryRuns(readFileSync(join(REPO, 'docs/harness/dry-runs.md'), 'utf8'));
    assert.match(String(r), /Claude Code \/ Success \/ Date:/);
    assert.match(String(r), /Codex \/ Impossible \/ Transcript:/);
  });
});

describe('cross-vendor smoke kit (M0.13)', () => {
  it('produces valid evidence and leaves no seed or seed verdict in the main checkout', () => {
    const sb = sandbox(['scripts', 'docs/backlog', '.harness/reviews'], { git: true });
    try {
      // fake reviewer: flags the seeded file for codex, misses for claude
      sb.write(
        'fake-reviewer.mjs',
        `import { readFileSync } from 'node:fs';
const [packet, vendor] = process.argv.slice(2);
const text = readFileSync(packet, 'utf8');
const hash = /^diff_sha256: ([0-9a-f]{64})$/m.exec(text)[1];
const file = /^diff --git a\\/(\\S+)/m.exec(text)[1];
const findings = vendor === 'codex' ? [{ id: 'F1', file, line: 1, severity: 'major', failure_scenario: 'seeded defect' }] : [];
console.log(JSON.stringify({ task: 'M0.13', kind: 'code', diff_sha256: hash, reviewer: vendor + ':fake', verdict: findings.length ? 'changes-requested' : 'pass', findings }));
`,
      );
      const r = sb.node('scripts/harness/kits/smoke.mjs', [], { env: { ...process.env, FLUXION_SMOKE_FAKE_REVIEWER: sb.path('fake-reviewer.mjs') } });
      assert.equal(r.status, 0, out(r));
      const record = JSON.parse(sb.read('.harness/reviews/cross-vendor-smoke.json'));
      assert.equal(checkReviewerSmoke(record, sb.read('.harness/reviews/digest.log')), true);
      assert.deepEqual(
        record.runs.map((x) => `${x.author}->${x.reviewer}:${x.caught}`),
        ['claude->codex:true', 'codex->claude:false'],
      );
      // main checkout: seeds absent, no local verdict files, no leftover worktree
      assert.ok(sb.read('scripts/gates/check-size.mjs').includes('if (n > max)'));
      assert.ok(sb.read('scripts/gates/check-tests-kept.mjs').includes('if (missing > 0) problems.push'));
      assert.equal(sb.git('status', '--porcelain', '--', 'scripts').stdout.trim(), '');
      assert.ok(!existsSync(sb.path('.harness/review')), 'no verdict bound to a seed may exist in the main checkout');
      assert.doesNotMatch(sb.git('worktree', 'list').stdout, /fluxion-smoke-/);
    } finally {
      sb.cleanup();
    }
  });

  it('waits for a manual (subagent) verdict for vendors listed in FLUXION_SMOKE_MANUAL', async () => {
    const sb = sandbox(['scripts', 'docs/backlog', '.harness/reviews'], { git: true });
    let child;
    try {
      sb.write(
        'fake-reviewer.mjs',
        `import { readFileSync } from 'node:fs';
const [packet] = process.argv.slice(2);
const hash = /^diff_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(packet, 'utf8'))[1];
console.log(JSON.stringify({ task: 'M0.13', kind: 'code', diff_sha256: hash, reviewer: 'codex:fake', verdict: 'pass', findings: [] }));
`,
      );
      const env = {
        ...cleanEnv(),
        FLUXION_SMOKE_FAKE_REVIEWER: sb.path('fake-reviewer.mjs'),
        FLUXION_SMOKE_MANUAL: 'claude',
        FLUXION_SMOKE_MANUAL_TIMEOUT_MS: '60000',
      };
      child = spawn(process.execPath, [sb.path('scripts/harness/kits/smoke.mjs')], { cwd: sb.dir, env });
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      const exited = new Promise((res) => child.on('exit', res));
      const packet = sb.path('.harness/tmp/smoke-packet-claude.md');
      for (let i = 0; i < 300 && !existsSync(packet); i++) await new Promise((r) => setTimeout(r, 200));
      assert.ok(existsSync(packet), `no manual packet; stdout: ${stdout}`);
      const hash = /^diff_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(packet, 'utf8'))[1];
      sb.write(
        '.harness/tmp/smoke-verdict-claude.json',
        JSON.stringify({
          task: 'M0.13',
          kind: 'code',
          diff_sha256: hash,
          reviewer: 'claude-subagent:reviewer',
          verdict: 'changes-requested',
          findings: [{ id: 'F1', file: 'scripts/gates/check-tests-kept.mjs', line: 1, severity: 'major', failure_scenario: 'seeded' }],
        }),
      );
      assert.equal(await exited, 0, stdout);
      const record = JSON.parse(sb.read('.harness/reviews/cross-vendor-smoke.json'));
      assert.equal(checkReviewerSmoke(record, sb.read('.harness/reviews/digest.log')), true);
      assert.equal(record.runs.find((r) => r.reviewer === 'claude').caught, true);
    } finally {
      child?.kill(); // never leave the smoke process polling with a registered worktree
      sb.cleanup();
    }
  });

  it('cleans up and copies nothing back when a reviewer fails mid-run', () => {
    const sb = sandbox(['scripts', 'docs/backlog', '.harness/reviews'], { git: true });
    try {
      rmSync(sb.path('.harness/reviews/cross-vendor-smoke.json'), { force: true }); // real evidence copied in
      const digestBefore = sb.read('.harness/reviews/digest.log');
      // first direction (codex) succeeds and is recorded in the worktree; second (claude) fails,
      // e.g. a CLI that is not logged in
      sb.write(
        'fake-reviewer.mjs',
        `import { readFileSync } from 'node:fs';
const [packet, vendor] = process.argv.slice(2);
if (vendor === 'claude') { console.error('not logged in'); process.exit(1); }
const hash = /^diff_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(packet, 'utf8'))[1];
console.log(JSON.stringify({ task: 'M0.13', kind: 'code', diff_sha256: hash, reviewer: 'codex:fake', verdict: 'pass', findings: [] }));
`,
      );
      const r = sb.node('scripts/harness/kits/smoke.mjs', [], { env: { ...process.env, FLUXION_SMOKE_FAKE_REVIEWER: sb.path('fake-reviewer.mjs') } });
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /claude reviewer failed[\s\S]*nothing was copied back/);
      assert.doesNotMatch(sb.git('worktree', 'list').stdout, /fluxion-smoke-/);
      assert.ok(!existsSync(sb.path('.harness/reviews/cross-vendor-smoke.json')));
      assert.equal(sb.read('.harness/reviews/digest.log'), digestBefore);
      assert.ok(!existsSync(sb.path('.harness/review')));
    } finally {
      sb.cleanup();
    }
  });
});
