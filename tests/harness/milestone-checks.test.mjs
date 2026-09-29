// NFR-DX-003 (M0 cp1 F1): completion legs reject stubs; only real evidence turns them green.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  changesetGaps,
  checkBacklogDone,
  checkDistArtifacts,
  checkDryRuns,
  checkReviewerSmoke,
  checkVerifyOutput,
  passingTestTitles,
} from '../../scripts/gates/milestone-checks.mjs';
import { out, sandbox } from './helpers.mjs';

/** Evaluate `expr` against the sandbox copy of milestone-checks.mjs (its git() uses that repo). */
function inRepo(sb, expr) {
  sb.write('probe.mjs', `import * as c from './scripts/gates/milestone-checks.mjs';\nconsole.log(JSON.stringify(${expr}));\n`);
  const r = sb.node('probe.mjs');
  assert.equal(r.status, 0, out(r));
  return JSON.parse(r.stdout);
}

const section = (tool, { success = true, impossible = true } = {}) =>
  `## ${tool}\n\n${success ? '### Success\nDate: 2026-10-01\nOutcome: goal ended when toy gate exited 0 (3 turns)\nTranscript: logs/success.txt\n\n' : ''}${impossible ? '### Impossible\nDate: 2026-10-01\nOutcome: stopped with blockedReason after 3 failed attempts\nTranscript: logs/impossible.txt\n\n' : ''}`;

describe('checkDryRuns (NFR-DX-003)', () => {
  it('accepts per-tool success and impossible sections with outcomes', () => {
    assert.equal(checkDryRuns(`# Dry runs\n\n${section('Claude Code')}${section('Codex')}`), true);
  });

  it('rejects a one-sentence stub that merely mentions the words', () => {
    const r = checkDryRuns('Claude and Codex dry runs: success and impossible cases all fine.');
    assert.match(String(r), /missing ## Claude Code, ## Codex/);
  });

  it('rejects a tool missing its impossible case', () => {
    const r = checkDryRuns(`${section('Claude Code')}${section('Codex', { impossible: false })}`);
    assert.match(String(r), /Codex \/ ### Impossible/);
  });

  it('rejects empty Outcome lines', () => {
    const r = checkDryRuns(`${section('Claude Code')}${section('Codex').replace(/Outcome: .*$/gm, 'Outcome:')}`);
    assert.match(String(r), /Codex \/ Success \/ Outcome:/);
  });
});

describe('checkReviewerSmoke (NFR-DX-003)', () => {
  const H1 = 'a'.repeat(64);
  const H2 = 'b'.repeat(64);
  const line = (...cols) => `${cols.join('\t')}\n`;
  const DIGEST =
    line('M0.13', H1, 'r1', 'changes-requested', 'codex:gpt-5', '1 findings') +
    line('M0.13', H2, 'r1', 'pass', 'claude-subagent:reviewer', '0 findings') +
    line('M0.22', 'c'.repeat(64), 'r1', 'pass', 'claude-subagent:reviewer', '0 findings');
  const run = (author, reviewer, caught, diff_sha256 = author === 'claude' ? H1 : H2) => ({
    author,
    reviewer,
    seededDefect: 'off-by-one in fixture',
    diff_sha256,
    caught,
  });

  it('accepts both directions, recorded for M0.13 by the matching vendor, with a catch', () => {
    assert.equal(checkReviewerSmoke({ runs: [run('claude', 'codex', true), run('codex', 'claude', false)] }, DIGEST), true);
  });

  it('rejects a single direction', () => {
    assert.match(String(checkReviewerSmoke({ runs: [run('claude', 'codex', true)] }, DIGEST)), /codex->claude/);
  });

  it('rejects when nothing was caught', () => {
    assert.match(String(checkReviewerSmoke({ runs: [run('claude', 'codex', false), run('codex', 'claude', false)] }, DIGEST)), /no direction caught/);
  });

  it('rejects runs without a well-formed verdict hash', () => {
    assert.match(String(checkReviewerSmoke({ runs: [run('claude', 'codex', true, 'x'), run('codex', 'claude', true)] }, DIGEST)), /diff_sha256/);
  });

  it('rejects a hash that was never recorded', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true, 'd'.repeat(64)), run('codex', 'claude', false)] }, DIGEST);
    assert.match(String(r), /1 run\(s\) have no M0\.13 verdict by that reviewer/);
  });

  it('rejects reusing a recorded review from another task', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true), run('codex', 'claude', true, 'c'.repeat(64))] }, DIGEST);
    assert.match(String(r), /1 run\(s\) have no M0\.13 verdict/);
  });

  it('rejects a run whose recorded reviewer is a different vendor', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true, H2), run('codex', 'claude', false, H1)] }, DIGEST);
    assert.match(String(r), /2 run\(s\) have no M0\.13 verdict by that reviewer/);
  });

  it('rejects two runs sharing one hash', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true, H1), run('codex', 'claude', false, H1)] }, DIGEST);
    assert.match(String(r), /its own diff_sha256/);
  });

  it('rejects an empty record', () => {
    assert.notEqual(checkReviewerSmoke({}, DIGEST), true);
  });
});

describe('checkFinalReview and checkHooksExecutable (NFR-DX-003)', () => {
  /** Temp repo whose first commit ("fixture baseline") predates the milestone. */
  function repo() {
    const sb = sandbox(['scripts', '.githooks'], { git: true });
    const commit = (file, msg) => {
      sb.write(file, `${msg}\n`);
      sb.git('add', '-A');
      sb.git('commit', '-q', '--no-verify', '-m', msg);
      return sb.git('rev-parse', 'HEAD').stdout.trim();
    };
    const baseline = sb.git('rev-parse', 'HEAD').stdout.trim();
    return { sb, commit, baseline };
  }
  const review = (range, extra = {}) => ({ milestone: 'M0', range, reviewer: 'claude-subagent:milestone-reviewer', findings: [], dispositions: [], ...extra });
  const check = (sb, r) => inRepo(sb, `c.checkFinalReview(${JSON.stringify(r)}, 'M0')`);

  it('accepts a range from before the first milestone commit to the last code commit, then bookkeeping only', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      commit('.harness/reviews/milestone-M0-final.json', 'M0.18: docs: record final review');
      assert.equal(check(sb, review(`${baseline}..${end}`)), true);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a review that does not cover later code commits', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      commit('src/c.txt', 'M0.3: feat: c after the review');
      assert.match(check(sb, review(`${baseline}..${end}`)), /changes src\/c\.txt/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects an empty range and a range starting after the first milestone commit', () => {
    const { sb, commit } = repo();
    try {
      const first = commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      assert.match(check(sb, review(`${end}..${end}`)), /is not before the first M0 commit/);
      assert.match(check(sb, review(`${first}..${end}`)), /is not before the first M0 commit/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects malformed reviews: no reviewer, non-array findings, disposition without action', () => {
    const { sb, commit, baseline } = repo();
    try {
      const end = commit('src/a.txt', 'M0.1: feat: a');
      const range = `${baseline}..${end}`;
      assert.match(check(sb, review(range, { reviewer: '' })), /no reviewer/);
      assert.match(check(sb, review(range, { findings: 'none' })), /findings must be an array/);
      const withF1 = { findings: [{ id: 'F1', severity: 'major' }] };
      assert.match(check(sb, review(range, { ...withF1, dispositions: [{ finding: 'F1' }] })), /disposition needs finding and one of/);
      assert.equal(check(sb, review(range, { ...withF1, dispositions: [{ finding: 'F1', disposition: 'argue' }] })), true);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects undispositioned major findings and wrong milestones', () => {
    const { sb, commit, baseline } = repo();
    try {
      const end = commit('src/a.txt', 'M0.1: feat: a');
      const r = review(`${baseline}..${end}`, { findings: [{ id: 'F1', severity: 'major' }] });
      assert.match(check(sb, r), /undispositioned F1/);
      assert.match(check(sb, { ...r, milestone: 'M1' }), /not for M0/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a range whose shas are not real commits of HEAD', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      assert.match(check(sb, review(`${baseline}..deadbeefdeadbeef`)), /deadbeefdeadbeef is not a commit/);
      assert.match(check(sb, review(`abcabcabc..${baseline}`)), /abcabcabc is not a commit/);
      sb.git('checkout', '-q', '-b', 'side');
      const side = commit('src/side.txt', 'M0.2: feat: side');
      sb.git('checkout', '-q', 'main');
      assert.match(check(sb, review(`${baseline}..${side}`)), /not an ancestor of HEAD/);
    } finally {
      sb.cleanup();
    }
  });

  it('requires tracked hooks to be executable', () => {
    const { sb } = repo();
    try {
      sb.git('update-index', '--chmod=+x', '.githooks/pre-commit', '.githooks/commit-msg');
      assert.equal(inRepo(sb, 'c.checkHooksExecutable()'), true);
      sb.git('update-index', '--chmod=-x', '.githooks/commit-msg');
      assert.match(inRepo(sb, 'c.checkHooksExecutable()'), /commit-msg/);
    } finally {
      sb.cleanup();
    }
  });
});

describe('checkBacklogDone (NFR-DX-003, M0 cp2 F1)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;
  const backlog = (...rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;

  it('accepts when every row is done and reopened targets are done', () => {
    const reviews = [
      {
        checkpoint: 'cp1',
        dispositions: [
          { finding: 'F1', disposition: 'reopen', target: 'M0.2' },
          { finding: 'F2', disposition: 'hand-off', target: 'M1' },
        ],
      },
    ];
    assert.equal(checkBacklogDone(backlog(row('M0.1', 'done'), row('M0.2', 'done')), 'M0', reviews), true);
  });

  it('rejects a row that is not done', () => {
    assert.match(String(checkBacklogDone(backlog(row('M0.1', 'done'), row('M0.2', 'blocked (needs CLI)')), 'M0')), /not done: M0\.2 \(blocked \(needs CLI\)\)/);
  });

  it('rejects a reopen whose target row is missing', () => {
    const reviews = [{ checkpoint: 'final', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.24' }] }];
    assert.match(String(checkBacklogDone(backlog(row('M0.1', 'done')), 'M0', reviews)), /reopened M0\.24 missing or not done/);
  });

  it('rejects a reopen that names no row, and an empty backlog', () => {
    const reviews = [{ dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'later' }] }];
    assert.match(String(checkBacklogDone(backlog(row('M0.1', 'done')), 'M0', reviews)), /names no M0 row/);
    assert.match(String(checkBacklogDone('# empty\n', 'M0')), /no M0 rows/);
  });
});

describe('checkBacklogDone inputs (M0.24 review F1-F3)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;

  it('rejects duplicate row ids (a later done row cannot hide a todo one)', () => {
    assert.match(String(checkBacklogDone(`${row('M0.13', 'todo')}\n${row('M0.13', 'done')}\n`, 'M0')), /duplicate backlog rows: M0\.13/);
  });

  it('loads reviews of any checkpoint name, and reads archived rows once archived', () => {
    const sb = sandbox(['scripts'], { git: true });
    try {
      sb.write('.harness/reviews/milestone-M0-cp1.json', JSON.stringify({ milestone: 'M0', checkpoint: 'cp1', dispositions: [] }));
      sb.write(
        '.harness/reviews/milestone-M0-cp3.json',
        JSON.stringify({ milestone: 'M0', checkpoint: 'cp3', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.26' }] }),
      );
      sb.write('.harness/reviews/milestone-M1-cp1.json', JSON.stringify({ milestone: 'M1', checkpoint: 'cp1', dispositions: [] }));
      sb.write('docs/backlog/current.md', `${row('M1.1', 'todo')}\n`);
      sb.write('docs/backlog/archive/M0.md', `${row('M0.1', 'done')}\n`);
      const names = inRepo(sb, "c.loadMilestoneReviews('M0').map((r) => r.checkpoint)");
      assert.deepEqual(names, ['cp1', 'cp3']);
      assert.match(inRepo(sb, "c.backlogTextFor('M0')"), /M0\.1/);
      assert.match(inRepo(sb, "c.checkBacklogDone(c.backlogTextFor('M0'), 'M0', c.loadMilestoneReviews('M0'))"), /cp3 F1: reopened M0\.26 missing or not done/);
    } finally {
      sb.cleanup();
    }
  });
});

describe('descoped rows (NFR-DX-003, user decision 2026-09-26)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;

  it('accepts a row descoped with a stated reason', () => {
    assert.equal(checkBacklogDone(`${row('M0.1', 'done')}\n${row('M0.2', 'descoped (user decision 2026-09-26; roadmap Deferred)')}\n`, 'M0'), true);
  });

  it('rejects a descoped reason that cites neither an ADR nor the Deferred table (M0 final F1)', () => {
    assert.match(String(checkBacklogDone(`${row('M0.1', 'descoped (not feasible)')}\n`, 'M0')), /not done: M0\.1/);
    assert.equal(checkBacklogDone(`${row('M0.1', 'descoped (user decision; ADR-0137)')}\n`, 'M0'), true);
  });

  it('rejects a bare descoped state and a descoped reopen target', () => {
    assert.match(String(checkBacklogDone(`${row('M0.1', 'descoped')}\n`, 'M0')), /not done: M0\.1/);
    const reviews = [{ checkpoint: 'cp9', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.2' }] }];
    assert.match(String(checkBacklogDone(`${row('M0.2', 'descoped (later; ADR-0137)')}\n`, 'M0', reviews)), /reopened M0\.2 missing or not done/);
  });
});

describe('checkVerifyOutput and checkDistArtifacts (NFR-DX-002, M1 cp1 F1)', () => {
  const OUT = 'PASS typecheck (1ms)\nPASS lint (1ms)\nSKIP api — not written\nFAIL knip (2ms)\nVERIFY all: FAIL (1s)\n';

  it('accepts when every required step has a PASS line', () => {
    assert.equal(checkVerifyOutput(OUT, ['typecheck', 'lint']), true);
  });

  it('rejects absent, skipped and failed steps by name', () => {
    const r = String(checkVerifyOutput(OUT, ['typecheck', 'api', 'knip', 'publint']));
    assert.match(r, /api=SKIP/);
    assert.match(r, /knip=FAIL/);
    assert.match(r, /publint=absent/);
  });

  it('does not treat a longer step name as a match (size vs size-limit)', () => {
    assert.match(String(checkVerifyOutput('PASS size-limit (1ms)\n', ['size'])), /size=absent/);
  });

  it('requires dist/index.js and dist/index.d.ts for every library', () => {
    const present = new Set(['packages/a/dist/index.js', 'packages/a/dist/index.d.ts', 'packages/b/dist/index.js']);
    assert.equal(
      checkDistArtifacts(['packages/a'], (p) => present.has(p)),
      true,
    );
    assert.match(String(checkDistArtifacts(['packages/a', 'packages/b'], (p) => present.has(p))), /packages\/b\/dist\/index\.d\.ts/);
  });
});

describe('passingTestTitles (M1.23 review: named cases are leaf tests)', () => {
  it('ignores a describe whose title matches when its children do not', () => {
    const sb = sandbox([]);
    try {
      sb.write(
        'probe.test.mjs',
        "import { describe, it } from 'node:test';\ndescribe('skipIf group', () => { it('plain child', () => {}); });\nit('detects runIf', () => {});\n",
      );
      // node flags before the file, as namedCases runs it (args after the file go to the script)
      const r = spawnSync(process.execPath, ['--test-reporter=spec', '--test-name-pattern=skipIf', sb.path('probe.test.mjs')], {
        encoding: 'utf8',
        // under --test the child would otherwise report to the parent runner instead of printing spec output
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')),
      });
      assert.equal(r.status, 0, out(r));
      assert.deepEqual(passingTestTitles(r.stdout), ['plain child']);
      assert.equal(passingTestTitles(r.stdout).filter((t) => t.includes('skipIf')).length, 0);
    } finally {
      sb.cleanup();
    }
  });

  it('does not count todo or skipped cases as passing (M1.10 review F1)', () => {
    const sb = sandbox([]);
    try {
      sb.write(
        'probe.test.mjs',
        "import { it } from 'node:test';\nit('todo skipIf case', { todo: true }, () => {});\nit('skipped skipIf case', { skip: true }, () => {});\n",
      );
      const r = spawnSync(process.execPath, ['--test-reporter=spec', '--test-name-pattern=skipIf', sb.path('probe.test.mjs')], {
        encoding: 'utf8',
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')),
      });
      assert.match(r.stdout, /# TODO/, out(r));
      assert.deepEqual(passingTestTitles(r.stdout), []);
    } finally {
      sb.cleanup();
    }
  });

  it('returns leaf titles without their durations', () => {
    const spec = '▶ suite\n  ✔ fails on skipIf without a trailer (12.5ms)\n  ✖ broken (1ms)\n✔ suite (20ms)\nℹ pass 1\n';
    assert.deepEqual(passingTestTitles(spec), ['fails on skipIf without a trailer']);
  });
});

describe('changesetGaps (M5.3, M4 final F1)', () => {
  const workspaces = [
    { dir: 'packages/core', name: '@fluxion/core', private: false },
    { dir: 'packages/routing', name: '@fluxion/routing', private: false },
    { dir: 'apps/studio', name: '@fluxion/studio', private: true },
  ];
  it('a package changed in the range without a changeset fails', () => {
    const changed = ['packages/core/src/a.ts', 'packages/routing/package.json', 'apps/studio/src/App.tsx', 'docs/x.md'];
    assert.deepEqual(changesetGaps(changed, ["---\n'@fluxion/core': minor\n---\n"], workspaces), ['@fluxion/routing']);
    // named in double quotes counts too; private workspaces and non-shipped files need none
    assert.deepEqual(changesetGaps(changed, ["---\n'@fluxion/core': minor\n---\n", '---\n"@fluxion/routing": patch\n---\n'], workspaces), []);
    assert.deepEqual(changesetGaps(['packages/routing/README.md', 'packages/core/api/core.api.md'], [], workspaces), []);
    // a name in the prose is no release: only frontmatter lines count (review F2)
    assert.deepEqual(changesetGaps(['packages/core/src/a.ts'], ["---\n'@fluxion/cli': minor\n---\n\nNow uses '@fluxion/core' outlines.\n"], workspaces), [
      '@fluxion/core',
    ]);
  });

  it('an older changeset does not cover a change of the range; one the range adds does (review F1)', () => {
    const sb = sandbox(['scripts', 'tools/gen'], { git: true });
    try {
      const commit = (path, text) => {
        sb.write(path, text);
        sb.git('add', path);
        sb.git('commit', '-q', '--no-verify', '-m', `M9.1: chore(x): ${path}`);
        return sb.git('rev-parse', 'HEAD').stdout.trim();
      };
      const base = commit('.changeset/old.md', "---\n'@fluxion/core': minor\n---\n\nOld.\n");
      commit('packages/core/src/a.ts', 'export const a = 1;\n');
      assert.match(inRepo(sb, `c.changesetsCoverRange('${base}')`), /no changeset for @fluxion\/core/);
      commit('.changeset/new.md', "---\n'@fluxion/core': minor\n---\n\nNew.\n");
      assert.equal(inRepo(sb, `c.changesetsCoverRange('${base}')`), true);
      // a file moved from core to routing changes both workspaces (review r2 F1)
      const moved = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('packages/routing/src/a.ts', 'export const a = 1;\n');
      sb.git('rm', '-q', 'packages/core/src/a.ts');
      sb.git('add', 'packages/routing/src/a.ts');
      sb.git('commit', '-q', '--no-verify', '-m', 'M9.2: chore(x): move');
      // git sees the identical file as a rename
      assert.match(sb.git('show', '--name-status', '--format=', 'HEAD').stdout, /^R100/m);
      commit('.changeset/move.md', "---\n'@fluxion/routing': minor\n---\n\nMoved.\n");
      assert.match(inRepo(sb, `c.changesetsCoverRange('${moved}')`), /no changeset for @fluxion\/core/);
    } finally {
      sb.cleanup();
    }
  });
});

describe('M5 legs made honest (M5 cp1 F4)', () => {
  it('readmeGaps rejects a stub, a heading alone and a README that names too little', async () => {
    const { readmeGaps } = await import('../../scripts/gates/milestone-checks.mjs');
    const full = [
      '# @fluxion/pack-basic',
      '',
      'The basic shapes:',
      '- basic:rect',
      '- basic:ellipse',
      'Register with definePack.',
      'More.',
      'Even more.',
      'Last line.',
    ].join('\n');
    assert.equal(readmeGaps(full, ['basic:rect', 'basic:ellipse']), true);
    assert.match(String(readmeGaps('# x\n\nstub (M1)\n', [])), /M1 stub/);
    assert.match(String(readmeGaps('# @fluxion/pack-basic\n', [])), /1 non-empty lines \(< 8\)/);
    assert.match(String(readmeGaps(full, ['basic:rect', 'basic:star', 'basic:cloud'])), /does not name basic:star, basic:cloud/);
  });

  it('propertyRuns reads the numRuns of the titled property, 0 when it relies on the default', async () => {
    const { propertyRuns } = await import('../../scripts/gates/milestone-checks.mjs');
    const src = [
      "it('A: first', () => { fc.assert(fc.property(x, f), { numRuns: 50 }); });",
      "it('FR-CON-012: after random transforms endpoints lie on anchors', () => {",
      '  fc.assert(fc.property(t, f), { numRuns: 1_000 });',
      '});',
      "it('C: other', () => { fc.assert(fc.property(x, f), { numRuns: 5000 }); });",
    ].join('\n');
    assert.equal(propertyRuns(src, 'FR-CON-012: after random transforms endpoints lie on anchors'), 1000);
    assert.equal(propertyRuns(src, 'A: first'), 50);
    // a property without numRuns runs fast-check's default: below the plan's 1 000
    assert.equal(propertyRuns("it('B', () => { fc.assert(fc.property(x, f)); });\nit('C', () => { fc.assert(p, { numRuns: 9000 }); });", 'B'), 0);
    assert.equal(propertyRuns(src, 'no such title'), 0);
    // the body ends at the next test or suite call in any style: a later property's runs do not count
    const loose = [
      "it('FR-CON-012: t', () => { fc.assert(fc.property(t, f)); });",
      "test('other', () => fc.assert(p, { numRuns: 5000 }));",
      'it("third", () => fc.assert(p, { numRuns: 7000 }));',
      "it.each([1])('fourth', () => fc.assert(p, { numRuns: 8000 }));",
      "describe('suite', () => { it('x', () => fc.assert(p, { numRuns: 9000 })); });",
    ];
    for (const next of loose.slice(1)) assert.equal(propertyRuns(`${loose[0]}\n${next}`, 'FR-CON-012: t'), 0, next);
    // the title in a comment, or inside another test, is not the test
    const commented = `// FR-CON-012: t runs a thousand times\nit('A', () => fc.assert(p, { numRuns: 3000 }));\ntest("FR-CON-012: t", () => fc.assert(p, { numRuns: 1200 }));`;
    assert.equal(propertyRuns(commented, 'FR-CON-012: t'), 1200);
    assert.equal(propertyRuns("it.skip('R (a+b)', () => fc.assert(p, { numRuns: 42 }));", 'R (a+b)'), 42);
    // a constant the file declares counts; any other expression cannot be read (M5.32 review F1)
    const named = "const RUNS = 1_500;\nit('N', () => fc.assert(p, { numRuns: RUNS }));";
    assert.equal(propertyRuns(named, 'N'), 1500);
    assert.ok(Number.isNaN(propertyRuns("it('N', () => fc.assert(p, { numRuns: runs() }));", 'N')));
    assert.ok(Number.isNaN(propertyRuns("it('N', () => fc.assert(p, { numRuns: MISSING }));", 'N')));
    // an expression is not its first operand (M5.23 review F1)
    assert.ok(Number.isNaN(propertyRuns("it('N', () => fc.assert(p, { numRuns: 5000 - 4999 }));", 'N')));
    assert.ok(Number.isNaN(propertyRuns(`${named.split('\n')[0]}\nit('N', () => fc.assert(p, { numRuns: RUNS / 100 }));`, 'N')));
    assert.equal(propertyRuns("it('N', () => fc.assert(p, { seed: 1, numRuns: 2_000 , verbose: true }));", 'N'), 2000);
    // a method named test inside the body does not end it (M5.32 review F2)
    assert.equal(propertyRuns("it('M', () => { if (/x/.test(s)) f(); fc.assert(p, { numRuns: 1200 }); });", 'M'), 1200);
  });

  it('coverageGaps fails a package under its floor or with too few statements', async () => {
    const { coverageGaps } = await import('../../scripts/gates/milestone-checks.mjs');
    const entry = (total, covered, btotal, bcovered) => ({
      statements: { total, covered },
      lines: { total, covered },
      branches: { total: btotal, covered: bcovered },
    });
    const summary = {
      'E:/repo/packs/basic/src/shapes/star.ts': entry(40, 40, 10, 10),
      'E:\\repo\\packs\\basic\\src\\index.ts': entry(30, 30, 4, 4),
      'E:/repo/packages/core/src/x.ts': entry(100, 0, 10, 0),
    };
    const floors = { lines: 90, branches: 85 };
    assert.equal(coverageGaps(summary, 'packs/basic', floors, 60), true);
    assert.match(String(coverageGaps(summary, 'packs/basic', floors, 100)), /70 statements \(< 100\)/);
    const low = { ...summary, 'E:/repo/packs/basic/src/shapes/cloud.ts': entry(30, 0, 10, 2) };
    assert.match(String(coverageGaps(low, 'packs/basic', floors, 60)), /packs\/basic: lines 70\.0%; branches 66\.7%/);
    assert.match(String(coverageGaps({}, 'packs/basic', floors, 1)), /0 statements/);
    // a package with no branches is not below a branch floor (M5.38): its statements still count
    const data = { 'E:/repo/packs/basic/src/shapes/rect.ts': entry(44, 44, 0, 0) };
    assert.equal(coverageGaps(data, 'packs/basic', floors, 40), true);
    assert.match(String(coverageGaps(data, 'packs/basic', floors, 60)), /^packs\/basic: 44 statements \(< 60\)$/);
  });
});
