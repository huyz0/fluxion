# Progress log

Append-only; newest last; ≤ 10 lines per entry (skill `brevity`).

## 2026-09-26 setup (claude)
done: research corpus (docs/research 00–06), requirements R0–R8, architecture 01–10 + ADR-0001..0010,
standards, harness skeleton (skills, adapters, gates, review binding), roadmap M0–M33 + plans
gates: precommit --all PASS (2 steps run, 10 SKIP pending M0/M1) on Node 26.7
baseline commit made with hooks bypassed (no task ID/review possible pre-harness) — only exception
next: M0.1 install pnpm, put node on PATH for hooks, `node scripts/harness/setup.mjs`
blocked: —

## 2026-09-26 M0 session 1 (claude, under /goal)
done: M0.1 pnpm 11.28 installed; run() quotes args for cmd.exe (no DEP0190); precommit --all PASS
gate m0: 5/18 — red: M0 scripts, tests/harness, CI, .codex, dry runs, guide, review
next: M0.2

## 2026-09-26 M0.2 (claude)
gate m0 confirmed red 5/18 (exit 1). red legs: check-size, check-tests-kept, check-drift,
build-index (+ index tables), stop-check, worktree scripts; tests/harness; gates.yml; .codex/;
dry-runs doc; harness guide; milestone review
argued: M0.1 F1/F2 (quoteWin % expansion, trailing backslash) — no caller affected

## 2026-09-26 M0.3 (claude)
done: tests/harness helpers + commit-msg suite 12/12; mutation check (weakened gate) -> 2 fail
fix: node --test needs a glob (tests/harness/*.test.mjs) in precommit + m0 gate
next: M0.4

## 2026-09-26 M0.4 (claude)
done: portability suite 14/14 (12 negative cases); mutation (drop built-in check) -> 1 fail
next: M0.5

## 2026-09-26 M0.5 (claude)
done: review binding suite 11/11 via the REAL tracked hook; mutation (reviewed step off) -> fails
fix (review r2): hooks tracked 100755 + setup.mjs chmod — POSIX git silently skipped them
next: M0.6

## 2026-09-26 M0.6 (claude)
done: check-size.mjs (AGENTS/skill/package AGENTS/backlog/progress/source-file caps) + 8 tests; mutation (>=) -> fails
fix: merged duplicate M0.5 progress entries (M0.5 review r3 F1)
note: function length/complexity caps enforced by Biome from M1
next: M0.7

## 2026-09-26 M0.7 (claude)
done: check-tests-kept (deleted/renamed test files, removed cases, added skip/todo/only) + 13 tests
moved to commit-msg hook (trailer only exists there); removed from precommit; mutation -> fails
next: M0.8

## 2026-09-26 M0.8 (claude)
done: check-drift (--msg in commit-msg hook; --commit <sha> for CI) + 10 tests; mutation -> 4 fail
moved drift out of precommit; M0.12 row now covers per-commit CI re-check (M0.7 F1 amend gap)
next: M0.9

## 2026-09-26 M0.9 (claude)
done: build-index.mjs (skills table from descriptions, standards table from Read when/Family) + 7 tests; precommit index step
added "> Family:" to 6 standards; tables regenerated; mutation -> 2 fail
argued: M0.8 F1 (t() accessor tampering is a reviewed code change)
next: M0.10

## 2026-09-26 M0.20 (claude)
done: M0.9 (cd08870); cp1 milestone review recorded (3 major reopened as M0.21-23, 2 minor handed to M1, 1 argued)
gate m0: 11/18
next: M0.10

## 2026-09-26 M0.10 (claude)
done: stop-check.mjs + 7 tests (inactive/red/green/blocked/cap/reset/missing gate); doc in .harness/README.md
test found ordering bug: cap checked before gate so a green gate could not reset — fixed
next: M0.11

## 2026-09-26 M0.11 (claude)
done: .codex/{config.toml,hooks.json,README.md} per current Codex hooks docs; adapters.test.mjs (4)
live Codex verification folded into M0.15 (codex CLI not installed here)
next: M0.12

## 2026-09-26 M0.16 (claude)
done: worktree.mjs create/remove/list + 4 tests; unmerged branches kept (mutation -D -> fails)
next: M0.12

## 2026-09-26 M0.16 fix (claude)
commit refused by hook: git exports GIT_INDEX_FILE=.git/index to hooks; broke git in sandbox worktree
fix: tests/harness helpers strip GIT_* env (cleanEnv) — suite 102/102 with hook-like env; real repo untouched

## 2026-09-26 M0.12 (claude)
done: .github/workflows/gates.yml (3 OSes, SHA-pinned checkout v7.0.1/setup-node v7.0.0, read-only token)
added check-commits.mjs + check-tests-kept --commit (closes M0.7 F1 amend gap); history e4273a6..HEAD 14/14 pass
not verified on GitHub: no push requested; workflow checked structurally (ci-workflow.test.mjs), actionlint not installed
next: M0.13

## 2026-09-26 M0.23 (claude)
done: gate tests live only in tests/harness (ci-cd.md, M1.md repointed); docs-consistency.test (fails on old docs)
precommit header already accurate after M0.12 (check-commits.mjs exists)
next: M0.22

## 2026-09-26 M0.22 (claude)
done: check-reviewed exempts backlog diffs only when just State/Commit cells change; review.mjs appends tracked .harness/reviews/digest.log
4 new tests (old gate fails 2); digest lags one commit by design (written after hashing)
next: M0.17

## 2026-09-26 M0.17 (claude)
done: docs/harness/README.md operator guide (setup, start, watch, unblock, finish, troubleshooting); linked from AGENTS.md
next: M0.21

## 2026-09-26 M0.21 (claude)
done: m0-complete legs behavioural (milestone-checks.mjs: dry-runs sections/outcomes, smoke both directions, final review range+dispositions, hooks 100755; deliverable->test map; latency legs NFR-DX-002)
13 tests with stub fixtures; gate 20/24 — red only: M0.13 smoke, M0.14/15 dry runs, M0.18 review, roadmap
also: guide says delete stop-blocks whenever blockedReason is cleared (M0.17 review F1)
next: M0.13/14/15 need a human (codex + claude CLIs, logins)

## 2026-09-26 M0.24 (claude)
done: M0.21 (53a3ac6); cp2 milestone review recorded (2 major reopened as M0.24/M0.25, 1 handed to hand-back checklist, 2 argued)
checkBacklogDone leg + 4 tests (every row done; reopen targets exist and are done)
next: M0.25 human kits, then stop (M0.13-15 need codex+claude CLIs)

## 2026-09-26 M0.25 (claude) — STOP, handed back
done: M0.24 (a22f0aa); kits: toy-gate (success/impossible), smoke.mjs (throwaway worktree, digest+evidence copied back), dry-run kit + dry-runs.md template (keeps gate red); checkDryRuns needs Transcript:
gate m0: 20/25 — red only: M0.13 smoke, M0.14/15 dry runs, M0.18 final review, backlog/roadmap
blocked: M0.13-M0.15 need Claude Code + Codex CLIs logged in (human) — state.json blockedReason set, loopActive=false
next (human): docs/harness/README.md section 7; then /goal resumes M0.13-15 commits, M0.18, roadmap to M1

## 2026-09-26 M0.13 (claude)
done: cross-vendor smoke 2/2 caught — claude->codex via Codex CLI 0.157.1 (installed, existing ChatGPT login), codex->claude via isolated Claude subagent (Claude CLI not logged in)
added FLUXION_SMOKE_MANUAL mode + test; evidence .harness/reviews/cross-vendor-smoke.json
still blocked: M0.14/M0.15 interactive /goal dry runs (human)

## 2026-09-26 M0.15 probe (claude)
codex exec with "/goal ..." ran as a plain prompt (no goal loop); toy success met; log kept locally at .harness/tmp/dryrun/codex-success.log (not recorded as the dry run)
kit doc now says: use the interactive TUI / Claude Code session
still blocked: M0.14/M0.15 (human, interactive /goal)

## 2026-09-26 M0.26 (claude)
user decision: drop interactive /goal dry runs from M0; reviews by isolated subagents only
done: M0.14/M0.15 descoped (roadmap Deferred); dry-runs leg removed; `descoped (<reason>)` closes a row (+2 tests); review default = subagent in skill/standard/AGENTS; guide section 7 now optional follow-ups
next: M0.18 final milestone review, roadmap to M1

## 2026-09-26 M0.18 (claude): M0 complete
final milestone review: pass; 2 major handed to M1 (descoping loophole first; gates.yml actionlint + first push), 3 minor argued
roadmap current -> M1; the M1 plan carries the hand-offs

## 2026-09-26 M1 session 1 (claude, under /goal)
done: M1.1 — M0 backlog archived; M1 backlog 22 rows (plan 20 + M0 hand-offs); m1-complete.mjs written red (1/28)
reviews: isolated subagent only (ADR-0137)
next: M1.2 descoping loophole

## 2026-09-26 M1.1 review note (claude)
round-2 verdict (93082925, 2 findings on ci.yml job parsing) was not recorded before fixing; the review record therefore shows one round fewer than actually happened (4 reviews for M1.1)

## 2026-09-26 M1.2 (claude)
done: check-reviewed never exempts a State change to descoped; checkBacklogDone needs ADR-NNNN or Deferred in the reason; gate probe runs the real check-reviewed case; M1.1 review F1 (grep probe) resolved

## 2026-09-26 M1.3 (claude)
done: check-workflows.mjs (actionlint 1.7.12 + zizmor 1.30.1 via digest-pinned Docker images; SKIP without Linux Docker unless --require-docker) + 5 tests; registered in precommit
fixed gates.yml zizmor artipacked (persist-credentials: false)
first green push of gates.yml on 3 OSes: run 36225774295 (ubuntu 46s, macos 22s, windows 2m52s); the persist-credentials change is re-verified by the next push

## 2026-09-26 M1.4 (claude)
done: root package.json (pnpm@11.28.0, node >=22.14), pnpm-workspace.yaml catalog (exact pins) + minimumReleaseAge 1440, .npmrc engine-strict, .node-version, lockfile; workspace-shape.test (4)
minimumReleaseAge rejected @types/node 26.6.3 and vitest 5.0.2 (under a day old): pinned 22.20.4 (engines floor) and 5.0.1
`pnpm setup` is a pnpm built-in, so the repo script runs as `pnpm run setup` (gate README leg adjusted)

## 2026-09-26 M1.5 (claude)
done: tsconfig.base.json (strict set + isolatedDeclarations, verbatimModuleSyntax, erasableSyntaxOnly, customConditions @fluxion/source); solution tsconfig.json (refs filled in M1.6); ADR-0011; tsconfig-strict.test (8 cases, mutation caught)
note: tsc 7 errors on an empty solution; typecheck script lands with packages (M1.6/M1.7); setup.mjs comment fixed (M1.4 review F1)

## 2026-09-26 M1.6 (claude)
done: tools/gen/workspaces.json (package map) + package.mjs (create-missing, --check, syncs root tsconfig references); 19 workspaces generated; root LICENSE; `pnpm typecheck` = tsc -b over all 19 (green); workspace-shape tests 28

## 2026-09-26 M1.7 (claude)
done: turbo.json (typecheck/build/test/test:coverage/test:related/lint with inputs/outputs); libraries build with tsdown (dist/index.js + index.d.ts, fixedExtension false) - pulled forward from M1.8 because the pipeline needs a build; second build FULL TURBO (turbo.test)
precommit: typecheck = root tsc -b over all workspaces (M1 cp1 F4); lint SKIPs with reason until biome.json (M1.9)
cp1 milestone review received: record + rows M1.23/M1.24 next

## 2026-09-26 M1.23 (claude)
cp1 milestone review recorded (2 major reopened as M1.23/M1.24, 4 minor handed off, 2 argued)
done: checkVerifyOutput (exact step names; test caught size vs size-limit), checkDistArtifacts, verify leg needs PASS per planned step, build leg needs dist, GATES + tests-kept/coverage negatives
fix (review r1): named-case legs run test files directly (under --test the file counts as a passing test, so pass>=1 was vacuous - also affected the M1.2 descoping probe); build leg clears dist and forces a build; vitest smoke leg added

## 2026-09-26 M1.8 (claude)
done: check-packages.mjs (publint --strict, attw esm-only) over 17 libraries; knip.json (harness scripts as entries) clean; .size-limit.js budgets from thresholds.mjs; precommit steps build/knip/publint/attw/size-limit (build moved before harness-tests for clean CI); packages.test (4)
catalog trimmed to installed pins (knip fails on unused catalog entries); later rows re-add theirs

## 2026-09-26 M1.9 (claude)
done: biome.json (recommended + standards rules; limits = thresholds; pure-package restricted globals + GritQL Math.random plugin; adapter any-allowlist); root lint = biome ci . (repo-wide), format = biome check --write
refactors to satisfy limits in lib.mjs (evalLeg), milestone-checks.mjs, review.mjs (STANDARDS_BY_PATH); one-time format sweep; .harness/reviews excluded so recorded verdicts stay byte-exact
biome.test (17): one negative fixture per rule, scope checks (pure/adapter), limits equal thresholds
review r1 pass + 2 minor fixed: generator formats what it writes (FLUXION_TOOLS_ROOT for sandbox); long-function exemption covers co-located *.test/*.spec

## 2026-09-26 M1.10 (claude)
done: check-size rejects utils/helpers/misc/common source files (code-structure rule 8); tests-kept catches skipIf/runIf/concurrent.skip and case swaps; count is net over the whole change so moving a case between files is fine
namedCases counts only passing leaf tests titled with the pattern (M1.23 review minor) via passingTestTitles
review r1 changes-requested (3) fixed: todo/skip lines are not passing tests; commented-out cases do not count as added; denylist covers src/ directories and .cjs/.cts/.jsx
open: contracts.md rule 10 says fixtures count as tests, but isTest excludes fixtures/ — belongs with the format-fixture milestone

## 2026-09-26 M1.11 (claude)
done: workspaces.json gains runtime + dependsOn (single source; check-layering compares it to the overview "May depend on" column and layer order); .dependency-cruiser.mjs built from it (layer, player-not-editor, packs-sdk-only, pure no node:*/DOM, T0 tests no DOM, deep/relative cross-workspace imports, circular, dev deps, unresolvable)
generator owns tsconfig lib/types (per runtime: pure ES-only, dom, node, mixed) and project references (from dependsOn); --check reports drift (cp1 F5, F6)
dependency-cruiser needs the TS compiler API (<7): own typescript@6 via packageExtensions; ADR-0011 amended
layering.test (14), workspace-shape +2 (no DOM in pure tsc; tsconfig drift)
review r1 pass + minor fixed: layering no longer SKIPs when the depcruise config is missing (fails in check-layering)

## 2026-09-26 M1.12 (claude)
done: root vitest.config.ts with node (T0) and browser (T1, Chromium via @vitest/browser-playwright) projects; v8 coverage floors per package from thresholds.mjs (pure 90/85, render+player 80/75, editor 70/65; +2 branch keys from testing.md §6)
generator emits src/index.test.ts smoke per workspace; render has a browser smoke; root test/test:coverage/test:related call vitest directly (turbo test tasks removed); CI installs chromium
fast-check: FC_SEED (fixed in CI) / FC_RUNS reach both projects (node via process.env, browser via import.meta.env — browser checked by an ad-hoc probe)
coverage.test (5): below the floor fails, render floor, no floor for cli, seed probe
review r1 changes-requested (3) fixed: .vitest/ ignored and probe screenshots dropped; setup installs chromium; M1.7 row, M1.md items 5/10, testing.md rule 1 say root Vitest config
