#!/usr/bin/env node
// Completion gate for M15 — MCP server, AI assistant & evals, the R2 exit (docs/milestones/M15.md). Written first and red (M15.1). Each leg runs the real test, build or
// gate; a test file a later row writes is named here from the start, so the leg fails as `missing <file>` until that row lands. M15 does not wait for
// the engines or CI evidence M12 to M14 still owe (roadmap Deferred).
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  loadMilestoneReviews,
  playwrightSpecs,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/** A Vitest run of `files` (node project; `project` picks another) whose JSON report shows tests passed and none failed, skipped or todo. */
function vitestReport(files, project = 'node') {
  const missing = files.filter((f) => !exists(f));
  if (missing.length) return `missing ${missing.join(', ')}`;
  const dir = mkdtempSync(join(tmpdir(), 'm15-vt-'));
  try {
    const out = join(dir, 'report.json');
    const r = run('pnpm', ['exec', 'vitest', 'run', '--project', project, '--reporter=json', `--outputFile=${out}`, ...files]);
    if (!existsSync(out)) return `vitest wrote no report: ${ok(r)}`;
    const rep = JSON.parse(readFileSync(out, 'utf8'));
    if (rep.numFailedTestSuites > 0 || rep.testResults.some((f) => f.status === 'failed' && f.assertionResults.length === 0))
      return `a test file failed to run (${rep.numFailedTestSuites} failed suites)`;
    const tests = rep.testResults.flatMap((f) => f.assertionResults);
    const bad = tests.filter((a) => a.status !== 'passed');
    if (bad.length) return `${bad.length} test(s) not passed (${[...new Set(bad.map((a) => a.status))].join('/')}): ${bad[0].title}`;
    return tests.length > 0 ? { titles: tests.map((a) => a.fullName ?? a.title) } : `${files.join(', ')}: no tests ran`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A Vitest file that exists and whose tests all pass: none skipped or todo, at least one run. */
const vitestFile = (file, project = 'node') => {
  const r = vitestReport([file], project);
  return typeof r === 'string' ? r : true;
};
const adr = (n, status = 'accepted') => {
  const dir = repoPath('docs/architecture/decisions');
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) return `missing ADR-${n}`;
  return new RegExp(`^status: ${status}\\b`, 'm').test(readFileSync(join(dir, file), 'utf8')) || `ADR-${n} is not ${status}`;
};

// ── requirements and decisions ─────────────────────────────────────────────────────────────────────
leg('check-trace --milestone M15 --priority M,S green: every requirement of the plan has a test naming it', () =>
  ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M15', '--priority', 'M,S'])),
);
leg('check-trace --increment R2 green: every Must requirement of R2 has a test naming it', () =>
  ok(node('scripts/gates/check-trace.mjs', ['--increment', 'R2'])),
);
for (const [n, what] of [
  ['0038', 'MCP server model'],
  ['0039', 'eval harness'],
  ['0040', 'Mermaid and Markdown import'],
  ['0041', 'provider adapters and key storage'],
])
  leg(`ADR-${n} (${what}) is accepted`, () => adr(n));
leg('AI_LINT_SCORE_MIN (85, weakens down) is in thresholds.mjs', () => {
  try {
    return t('AI_LINT_SCORE_MIN') === 85 || `AI_LINT_SCORE_MIN is ${t('AI_LINT_SCORE_MIN')}`;
  } catch {
    return 'AI_LINT_SCORE_MIN is not in thresholds.mjs';
  }
});

// ── the MCP server ─────────────────────────────────────────────────────────────────────────────────
leg('a client lists the server tools over the in-memory transport (FR-MCP-001)', () => vitestFile('packages/mcp/src/server.test.ts'));
leg('the stdio server starts from its bin and lists its tools to a spawned client (FR-MCP-001)', () => vitestFile('packages/mcp/src/e2e/stdio.test.ts'));
leg('the read tools return diagnostics and a revision (FR-MCP-001)', () => vitestFile('packages/mcp/src/server.test.ts'));
leg('the write tools enforce roots and revisions; a path outside the roots writes nothing (FR-MCP-001)', () =>
  vitestFile('packages/mcp/src/tools-write.test.ts'),
);
leg('the HTTP transport binds 127.0.0.1 and refuses a foreign Origin; render_screen_png returns image/png (FR-MCP-001)', () =>
  vitestFile('packages/mcp/src/http.test.ts'),
);
leg('the inspector lists 11 tools, 6 resource URIs and 3 prompts (FR-MCP-002)', () => {
  const r = vitestReport(['packages/mcp/src/inspector.test.ts']);
  if (typeof r === 'string') return r;
  return (
    ['11 tools', '6 resource URIs', '3 prompts'].every((w) => r.titles.some((x) => x.includes(w))) ||
    'the inspector test must name 11 tools, 6 resource URIs and 3 prompts'
  );
});

// ── generation, evals, accessibility lint ──────────────────────────────────────────────────────────
leg('the orchestrator repairs a broken screen in round 1 and compiles leniently after the third failure (FR-AI-009)', () =>
  vitestFile('packages/dsl/src/generate/orchestrator.test.ts'),
);
leg('the alt-text and reading-order lint rules each have a positive and a negative fixture (NFR-A11Y-006)', () =>
  vitestFile('packages/dsl/src/lint/a11y.test.ts'),
);
leg('pnpm eval --recorded writes a deterministic scorecard of at least 30 cases (FR-AI-009)', () => {
  if (!exists('eval/cases')) return 'missing eval/cases';
  const cases = readdirSync(repoPath('eval/cases')).filter((f) => f.endsWith('.json'));
  if (cases.length < 30) return `${cases.length} eval cases (< 30)`;
  const a = run('pnpm', ['eval', '--recorded']);
  if (a.status !== 0) return `eval failed: ${ok(a)}`;
  const first = readFileSync(repoPath('eval/out/scorecard.json'), 'utf8');
  const b = run('pnpm', ['eval', '--recorded']);
  if (b.status !== 0) return `second eval failed: ${ok(b)}`;
  return first === readFileSync(repoPath('eval/out/scorecard.json'), 'utf8') || 'two recorded runs gave different scorecards';
});
leg('the scorecard meets AI_ONE_SHOT_VALID_PCT, AI_AFTER_REPAIR_VALID_PCT and AI_LINT_SCORE_MIN and reports alt-text coverage (NFR-AI-001, NFR-AI-004)', () => {
  const sc = json('eval/out/scorecard.json');
  if (!sc) return 'missing eval/out/scorecard.json';
  const bad = [];
  if (!(sc.oneShotValidPct >= t('AI_ONE_SHOT_VALID_PCT'))) bad.push(`one-shot ${sc.oneShotValidPct}`);
  if (!(sc.afterRepairValidPct >= t('AI_AFTER_REPAIR_VALID_PCT'))) bad.push(`after-repair ${sc.afterRepairValidPct}`);
  if (!(sc.lintMean >= t('AI_LINT_SCORE_MIN'))) bad.push(`lint mean ${sc.lintMean}`);
  if (typeof sc.altTextCoveragePct !== 'number') bad.push('no alt-text coverage');
  return bad.length === 0 || `below threshold: ${bad.join(', ')}`;
});

// ── import and assets ──────────────────────────────────────────────────────────────────────────────
leg('the Mermaid fixtures compile, validate and render, and their FluxScript goldens hold (FR-IMP-001, FR-DSL-007)', () =>
  vitestFile('packages/dsl/src/import/mermaid/mermaid.test.ts'),
);
leg('the Markdown outline fixture gives the expected screens and renders (FR-IMP-002)', () => vitestFile('packages/dsl/src/import/markdown/markdown.test.ts'));
leg('a file with embedded external assets renders with the network blocked (FR-AST-006)', () => vitestFile('packages/format/src/embed-external.test.ts'));

// ── the studio ─────────────────────────────────────────────────────────────────────────────────────
leg('the provider adapters stream and parse against mocked fetch, and keys live only in IndexedDB (FR-AI-007)', () =>
  vitestFile('apps/studio/src/ai/adapters.test.ts'),
);
leg('a seeded fake key is in none of the saved files, logs or the diagnostic report (NFR-SEC-004)', () => vitestFile('apps/studio/src/ai/key-leak.test.ts'));
leg(
  'the AI panel applies as one undo step, the external-asset embed renders offline, and no key leaks into a saved file (FR-EDT-014, FR-AST-006, NFR-SEC-004)',
  () => playwrightSpecs(['e2e/ai-panel.apply-undo.spec.ts', 'e2e/assets.embed-external.spec.ts', 'e2e/key-leak.spec.ts'], ['chromium']),
);

// ── CI matrix, the demo, the exit ──────────────────────────────────────────────────────────────────
leg('the CI workflow runs the CLI and MCP e2e tests on ubuntu, windows and macos with Node 22 and 24 (NFR-PORT-004)', () => {
  const wf = ['.github/workflows/ci.yml', '.github/workflows/gates.yml']
    .filter(exists)
    .map((f) => readFileSync(repoPath(f), 'utf8'))
    .join('\n');
  const need = [/ubuntu-latest/, /windows-latest/, /macos-latest/, /node-version:\s*\[[^\]]*22[^\]]*24|node-version:\s*\[[^\]]*24[^\]]*22/, /@fluxion\/mcp/];
  return need.every((re) => re.test(wf)) || 'no OS x Node 22/24 matrix running the CLI and MCP e2e tests';
});
leg('the R2 demo compiles, builds a .flux.html, renders every screen and scores at least AI_LINT_SCORE_MIN', () => {
  for (const f of ['examples/r2-ai-deck.flux.yaml', 'examples/r2-ai-deck.transcript.md']) if (!exists(f)) return `missing ${f}`;
  return vitestFile('scripts/examples/r2-demo.test.ts');
});
leg('the R2 exit checklist lists every criterion with evidence', () => {
  if (!exists('docs/milestones/exits/R2.md')) return 'missing docs/milestones/exits/R2.md';
  const rows = readFileSync(repoPath('docs/milestones/exits/R2.md'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\|.*\]\(.+\)/.test(l));
  return rows.length >= 8 || `only ${rows.length} checklist rows with an evidence link (< 8)`;
});

// ── coverage, changesets, quarantines ──────────────────────────────────────────────────────────────
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M15\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M15 commits yet';
});
leg('no open test quarantines and no open M15 spec folder', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  if (hits.length) return `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
  const open = (exists('specs') ? readdirSync(repoPath('specs'), { recursive: true }) : [])
    .map(String)
    .filter((p) => /(^|[\\/])M15[^\\/]*[\\/]tasks\.md$/.test(p));
  const unfinished = open.filter((p) => /^- \[ \]/m.test(readFileSync(repoPath(`specs/${p}`), 'utf8')));
  return unfinished.length === 0 || `open M15 spec tasks: ${unfinished.join(', ')}`;
});

// ── the tree, CI and the review ────────────────────────────────────────────────────────────────────
const VERIFY_STEPS = [
  'build',
  'harness-tests',
  'typecheck',
  'lint',
  'test',
  'knip',
  'publint',
  'attw',
  'size-limit',
  'layering',
  'licenses',
  'trace',
  'api',
  'budget',
  'kind-switch',
  'mode-policy',
];
leg('pnpm verify exits 0 with every planned step PASS', () => verifyLeg(VERIFY_STEPS));
leg('CI green on ubuntu, windows and macos at or after the M15 final review range', () => {
  if (!exists('.harness/reviews/milestone-M15-final.json')) return 'no M15 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M15']));
});
leg('every M15 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M15'), 'M15', loadMilestoneReviews('M15')));
leg('final milestone review covers M15', () => {
  const rev = json('.harness/reviews/milestone-M15-final.json');
  return rev ? checkFinalReview(rev, 'M15') : 'missing .harness/reviews/milestone-M15-final.json';
});
leg(
  'roadmap advanced past M15',
  () => (currentMilestone() !== null && !/^M(\d|1[0-5])$/.test(currentMilestone())) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m15');
