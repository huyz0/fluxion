// NFR-PORT-005 / NFR-SEC-005: the gates workflow runs the local gate definitions on three OSes
// with SHA-pinned actions, and re-checks every commit. Structural check (no YAML dependency).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

const wf = readFileSync(join(REPO, '.github/workflows/gates.yml'), 'utf8');

describe('gates workflow (NFR-PORT-005)', () => {
  it('runs on ubuntu, windows and macos', () => {
    assert.match(wf, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  });

  it('pins every action to a full commit SHA (NFR-SEC-005)', () => {
    const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 2);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `unpinned action ${u}`);
  });

  it('runs the same gate scripts as the local hooks', () => {
    assert.match(wf, /node scripts\/gates\/precommit\.mjs --all/);
    assert.match(wf, /node --test "tests\/harness\/\*\.test\.mjs"/);
    assert.match(wf, /node scripts\/gates\/check-commits\.mjs --range/);
  });

  it('never cancels or replaces push runs (each push range must be checked)', () => {
    const c = /concurrency:[\s\S]*?cancel-in-progress:\s*(.+)/.exec(wf)?.[1].trim();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression, not a JS template
    assert.equal(c, "${{ github.event_name == 'pull_request' }}");
    // a shared group lets GitHub replace a pending push run; pushes are grouped per SHA
    const g = /concurrency:\s*\n\s*group:\s*(.+)/.exec(wf)?.[1].trim();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression, not a JS template
    assert.equal(g, "gates-${{ github.event_name == 'pull_request' && github.ref || github.sha }}");
  });

  it('grants read-only token permissions', () => {
    assert.match(wf, /^permissions:\n {2}contents: read$/m);
  });
});

describe('check-commits (NFR-DX-004)', () => {
  it('fails a commit that bypassed the commit-msg hook, passes a justified one', () => {
    const sb = sandbox(['scripts', 'docs/backlog'], { git: true });
    try {
      const base = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('tests/harness/x.test.mjs', "it('a', () => {});\n");
      sb.git('add', '-A');
      sb.git('commit', '-q', '--no-verify', '-m', 'M0.12: test: add x');
      sb.git('rm', '-q', 'tests/harness/x.test.mjs');
      sb.git('commit', '-q', '--no-verify', '-m', 'M0.12: test: drop x');
      const bad = sb.node('scripts/gates/check-commits.mjs', ['--range', `${base}..HEAD`]);
      assert.equal(bad.status, 1, out(bad));
      assert.match(bad.stdout, /FAIL \w+ M0\.12: test: drop x[\s\S]*tests-kept/);
      sb.git('commit', '-q', '--amend', '--no-verify', '-m', 'M0.12: test: drop x', '-m', 'Removes-test: obsolete fixture');
      const good = sb.node('scripts/gates/check-commits.mjs', ['--range', `${base}..HEAD`]);
      assert.equal(good.status, 0, out(good));
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a malformed range', () => {
    const sb = sandbox(['scripts'], { git: true });
    try {
      assert.equal(sb.node('scripts/gates/check-commits.mjs', ['--range', 'nope']).status, 2);
    } finally {
      sb.cleanup();
    }
  });
});
