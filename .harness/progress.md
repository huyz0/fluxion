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

## 2026-09-26 M1.13 (claude)
done: check-trace.mjs — unknown IDs in test titles (vitest, node:test, Playwright, incl. enclosing describe) and backlog Req cells; matrix rows and summary vs requirement files; --milestone / --increment Must coverage; --write fills the matrix Tests column (run once: 13 IDs traced)
found: area codes with digits (A11Y, I18N) — first regex missed 9 requirements; tests-kept fixtures used fake FR-X-00n IDs (renamed CASE-n); M1.22 Req cell 'all' → HARNESS
M1 trace leg still red until M1.15 names NFR-LIC-002
trace.test (10)
review r1 pass + 4 minor fixed: commented-out calls and fixture strings are not titles; .each with nested args/tagged templates; summary row required per increment; trace skips only when docs/requirements is absent

## 2026-09-26 M1.28 (claude)
why: M1.25 staged ladder hit 125-150 s with no machine load (harness suite ~70 s, publint+attw ~40 s, serial); raising the budget would weaken NFR-DX-002
done: steps after build run concurrently (Promise.all), printed in ladder order; serial fallback without the barrier (quick); runAsync/nodeAsync in lib.mjs; --all now ~68 s
checked: a turbo cache hit does not rewrite dist/ (mtime unchanged), so turbo.test cannot race publint/attw
ladder.test (3). M1.25 work stashed meanwhile (stash m1.25-wip), resumed after this commit
review r1 pass + minor fixed: runAsync decodes the stream as utf8 (a 5-byte pattern proves a split character; the 8-byte one aligned with 64 KiB chunks and passed without the fix)
review r2 pass; 2 minor (string-unaware comment strip; fixture calls after a space) → backlog M1.25 (scanner that knows strings/comments)

## 2026-09-26 M1.25 (claude)
cp2 milestone review recorded (7 findings: 2 major, 5 minor → rows M1.25-M1.27, doc sync folded into M1.22, contracts rule 10 handed off to M2)
done: scripts/gates/test-titles.mjs scanner (strings, templates incl. ${}, comments, regex literals); skip/todo in every form does not cover a requirement; check-trace uses it
test-titles.test (6), trace.test +1 (skipped/todo Must ID fails --milestone)
review r1 changes-requested fixed: a skipped/todo/skipIf describe marks every call in its callback as not running
review r2 changes-requested (2) fixed: fixme/fails/fail count as not running; matches starting in strings re-search; plus runtime skips in a body (test.skip(cond), t.skip/t.todo, ctx.skip) skip the enclosing test

## 2026-09-26 M1.29 (claude)
done: scanner r3 minors (receiver-aware runtime skips, nested options + fails, file-level runner skip, x-prefix and focus reported); check-tests-kept rewritten on the scanner: before/after titles per changed test file, net running cases, swaps, newly non-running, new .only
tests-kept.test +9 (option skip, skipped suite, x-prefix, only option, strings are not tests), test-titles.test +4; smoke-kit seed moved to the new swap line
review r1 changes-requested (3) fixed: swap detection counts copies (multiset); expression titles read, runtime test.skip(cond[, reason]) told apart from it.skip(expr, fn); shorthand/spread/variable options and destructured skip() count as skipping; Playwright steps are not cases
review r2 pass + 2 minor fixed: chain members must be test modifiers (hooks/config are not tests); test.describe is a suite; only it/test count as cases (steps and suites renamed freely)

## 2026-09-26 M1.30 (claude)
done: MODIFIERS gains vitest 'shuffle' (M1.29 r3 minor, round cap reached there); test-titles.test +1
review r1 pass + 4 minor fixed: suite (root and member), expectFailure (chain and option), override/scoped/extend chains

## 2026-09-26 M1.26 (claude)
done: `Renames-test: <old> -> <new>` trailer; each pair must match a swapped-out and an added running title (multiset), an unmatched pair always fails; Removes-test stays for real removals; git.md trailer table updated; smoke-kit seed moved
tests-kept.test +4
review r1 pass + 3 minor fixed: a rename pair needs identical arguments (scanner exposes rest); titles with ' -> ' pair at any split; CRLF messages; header + git.md state the contract
review r2 pass + minor fixed: rest skips the whole title token (quotes) and separating/trailing commas, so quote style and wrapping do not block a rename

## 2026-09-26 M1.31 (claude)
done: restAfterTitle collapses whitespace only where codeMask says code (M1.26 r3 minor; round cap reached there); tests-kept.test +1
review r1 pass + minor fixed: codeMask tags comments (2); their whitespace collapses like code, only strings/templates stay verbatim

## 2026-09-26 M1.27 (claude)
done: `pure` field dropped (runtime is the one source; biome.test checks the pure override glob against it); restricted globals + crypto/queueMicrotask/setImmediate/XMLHttpRequest/WebSocket/navigator; GritQL catches Math.random references and `= Math` aliases; DOM_LIBS + vitest/browser; not-to-undeclared-dep rule
found: depcruise `exclude` dropped every npm edge (node_modules, and any `dist/` npm packages resolve into), so dev-dep/undeclared/DOM rules could never fire on installed packages; now only our own dist/.tsbuild/coverage
negatives: layering +4 (vitest/browser in T0, undeclared, dev dep, unresolvable), coverage +2 (player, editor floors), biome +4; turbo lint task removed, turbo.test requires a workspace script per task
review r1 changes-requested (2) fixed: globalThis/self/global denied in pure packages; grit narrowed (Math.random, Math?.random, destructured random, identifier aliases of Math; other Math members fine)
review r2 changes-requested (2) fixed: grit inverted - Math only as Math.<member other than random> (catches default params, assignments, properties, Math['random']); no-wall-clock.grit: DateTimeFormat format()/formatToParts() with no date

## 2026-09-26 M1.32 (claude)
done: no-wall-clock.grit bans DateTimeFormat in pure packages (formatting behind a port); Temporal denied; Math rule skips property names, `{ Math: v }` keys (unless v is Math) and interface/type-alias bodies; biome.test +4
review r1 changes-requested (2) fixed: property-name exclusions dropped (within exempted every Math under the key/object, e.g. { Math: Math.random() }); only interface and type-alias bodies are exempt; value properties named Math stay flagged

## 2026-09-26 M1.33 (claude)
why: M1.32 commit hook failed once: packages.test copied packages/core while tsc -b / attw (concurrent since M1.28) rewrote files there (ENOENT); passes alone
done: helpers.sandbox filters TRANSIENT (.tsbuild, node_modules, coverage, .turbo, *.tgz); ladder.test +1

## 2026-09-26 M1.15 (claude)
done: check-licenses.mjs (pnpm licenses list: shipped deps of packages/apps vs allowlist, each pack with its named exceptions, every dep vs GPL/AGPL/SSPL/BUSL prefixes and watermark packages; SPDX OR/AND; LICENSE per workspace + package.json MIT; root NOTICE)
policy = LICENSES in thresholds.mjs (tech-stack.md says so); check-drift treats allow/exception growth or deny shrink as weakening
licenses.test (11), drift.test +4; trace --milestone M1 now covers every Must ID (NFR-LIC-002)
review r1 changes-requested (3) fixed: failed/unreadable pnpm output fails the gate; dev listing is recursive (every workspace); deny match case-insensitive and version-spelling tolerant (not LGPL)
review r2 changes-requested (2) fixed: spdx.mjs parses expressions with precedence/grouping/WITH (grouped AND GPL no longer slips through); non-SPDX text fails closed for shipped code and is denied by GPL/General Public License/Affero text match (not Lesser/Library); spdx.test (5), licenses.test +3

## 2026-09-26 M1.34 (claude)
done: DENY_TEXT also tested on each parsed id; Lesser/Library guard covers the GPL word; boundary = not after a letter/digit (GNU_GPL); licenses.test +6 assertions (M1.15 r3 minors; round cap reached there)
review r1 pass + minor fixed: Lesser/Library guard accepts any separator run (variable-length lookbehind)
review r2 pass + minor fixed: guard needs the word Lesser/Library joined by whitespace . _ / - only

## 2026-09-26 M1.14 (claude)
done: check-api.mjs runs API Extractor (node API, one config per library, bundled TS 5.9 on emitted .d.ts) against committed packages/*/api/*.api.md; ae-missing-release-tag and every other warning fail; --update writes reports; TypeDoc (typedoc.json, notDocumented/invalidLink) validates TSDoc on TS 6
TS 6 route: apps/docs installs typedoc + typescript from named catalog `typescript6` (a packageExtensions dep or an override does not reach a peer); ADR-0011 amended (API Extractor needs no TS 6)
generated index.ts headers put the package name in backticks (a bare @fluxion/x read as a TSDoc tag); api.test (4)
review r1 pass + 2 minor fixed: ADR-0011 Context/Confirmation/index row and the planned-pins comment no longer say API Extractor runs on TS 6

## 2026-09-27 M1.35 (claude)
cp3 milestone review recorded (7 findings: 2 major, 5 minor): F1 ladder writers -> M1.36, F2 process -> triage rule in code-review skill (this commit), F3/F5 -> M1.36, F4 -> M1.37 (doc sync split from M1.22), F6 bookkeeping here, F7 argued
from now: a minor on a pass verdict is a row only if it is a realistic false green on a plan leg
review r1 changes-requested (4) fixed: cp2/cp3 dispositions use target/note (the keys checkBacklogDone reads; checked with all rows done vs M1.36 open); M1.37 acceptance names concrete docs-consistency cases incl. one TS 6 pin source; triage rule covers minors on any verdict

## 2026-09-27 M1.36 (claude)
done: harness tests no longer write the repo: turbo.test's real-repo build case removed (duplicate of the m1-complete build leg; pnpm in a linked sandbox tried to reinstall the repo's node_modules), api.test checks a full sandbox copy, Vitest cacheDir .vitest-cache per checkout (sandboxes linked node_modules/.vite)
check-suite-isolation.mjs (m1-complete leg): runs the suite, fails on any created/rewritten/deleted file; repo run: 1427 files untouched
found: TypeDoc validation sat at the root, which packages mode ignores - notDocumented was off (cp3 F3 was right); now in packageOptions, api.test negative
check-trace fails on a stale matrix Tests column (refreshed); trace.test +1, isolation.test (3)

## 2026-09-27 M1.37 (claude)
done: doc sync (cp2 F4, cp3 F4): tech-stack Node 22.19 + TS rows; ci-cd quick tier as implemented; code-structure new-package steps via workspaces.json + generator; 09-extensibility report path api/; M1.md no tsgo; documentation.md rule 8 allows a dated Amendments section for corrections of detail, ADR-0011 has one
single TS 6 pin: first tried catalog:typescript6 in packageExtensions (a stale lockfile hid that pnpm rejects it; see below)
setup.mjs checks the engines floor via lib belowFloor; docs-consistency.test +6; M1.36 argued minors committed here
single TS 6 pin: pnpm rejects catalog: in packageExtensions (a stale lockfile had hidden it), so the one npm:typescript@6.0.3 string is YAML-anchored in packageExtensions and aliased by the typescript6 catalog; staged ladder now 117 s (harness suite ~115 s concurrent) - budget work in M1.19
review r1 changes-requested (4) fixed: ADR amendment describes the YAML-anchor route; M1.md names dependency-cruiser; tests check every package's typescript spec, dated amendment lines, and run setup.mjs (the floor check now runs first and exits)

## 2026-09-27 M1.16 (claude)
done: playwright.config.ts (5 projects: chromium, firefox, webkit, Pixel 7, iPhone 14; 1280x800, UTC, en-US, reduced motion, maxDiffPixelRatio 0.001; retries 1 detect-only; webServer = studio vite on 4173); e2e/test.ts blocks non-localhost requests; e2e/pages/studio.ts; smoke spec (boots + block proven: the block test fails with the route disabled)
apps/studio: Vite 8 + React 19 blank shell (App named export, main.tsx, vite.config.ts, jsx react-jsx); e2e/tsconfig.json is referenced by the root solution (generator keeps ./e2e), so specs are type-checked
harness: linkInstalls(sb) links root + workspace node_modules (studio keeps react locally); sandboxes copying the root tsconfig also copy e2e
review r1 changes-requested (5) fixed: block moved to the context (route + routeWebSocket, every page; serviceWorkers block) with a blocked[] record the test asserts (a closed socket alone was vacuous); mobile projects grepInvert @visual; e2e serves the built studio (preview on 4317); axe fixture (expectAccessible, 0 serious/critical) + @no-a11y tag; smoke titles carry no requirement ID

## 2026-09-27 M1.38 (claude)
why: M1.17's staged ladder hit 123-126 s idle; profiling: tests-kept.test alone 80 s (fresh git sandbox per case, serial within a file), drift 29 s
done: one sandbox per file reset to the fixture commit after each case (reset --hard, clean -fdx, unset hooksPath); tests-kept split into tests-kept.test (21) + tests-kept-disabling.test (30) over tests-kept-fixture.mjs; tests-kept 80 -> 16/22 s in parallel, drift 29 -> 15 s; named-case leg points at the disabling file
M1.17 work stashed meanwhile (m1.17-wip)
## 2026-09-27 M1.17 (claude)
done: Storybook 10.6 in packages/editor (@storybook/react-vite, addon-a11y, .storybook/main.ts); EmptyState component + stories; story test via portable stories (composeStories) in the Vitest browser project with axe (0 violations; image-alt probe fails it); test:storybook script
ADR-0139: @storybook/addon-vitest 10.6 supports Vitest <= 4 only, so portable stories until it supports 5; tech-stack row updated
pnpm 11 blocks esbuild's postinstall (ERR_PNPM_IGNORED_BUILDS fails install): allowBuilds esbuild false - esbuild works via its optional platform binary
M1.16 minor fixed here: studio vite.config comment names the preview command
review r1 changes-requested (4) fixed: kebab-case files (empty-state.*); the browser test composes every story (it.each) in its own root with real unmount; design-ui rule 32 and the backlog row cite ADR-0139
digest note: the M1.38 r1 digest line was discarded by a checkout before the stash pop and re-appended from the stored verdict (.harness/review/75c125c3...r1.json)

## 2026-09-27 M1.18 (claude)
done: apps/docs Astro 7 + Starlight 0.42 site (index + getting-started guide), starlight-typedoc API pages for @fluxion/core (TypeDoc on TS 6 in the same workspace), starlight-llms-txt (llms.txt, -full, -small; site = GitHub Pages URL); build ~7 s; generated API markdown and .astro/ gitignored; content.config.ts excluded from tsc (astro:content is Astro's)
Changesets: .changeset/config.json (public access), `pnpm changeset status` exits 0; libraries get publishConfig { access: public, provenance: true } (generator too)
ladder build step builds libraries only (turbo --filter ./packages/* ./packs/*): docs and studio build in CI and the milestone gate; M1.17 minor fixed (ADR-0139 file name)
review r1 changes-requested: --all builds every workspace (CI gates.yml keeps building apps), staged builds libraries only; turbo inputs for docs (astro.config, typedoc.json, core src/tsconfig; generated api excluded) and studio (index.html, vite.config); F3 argued

## 2026-09-27 M1.19 (claude)
done: check-budget.mjs (--record measures quick, staged and a cold setup = fresh local clone + pnpm i --frozen-lockfile + pnpm run setup + pnpm verify; default checks .harness/budget.json against QUICK_GATE_BUDGET_MS, PRECOMMIT_BUDGET_MS, new COLD_SETUP_MAX_MS 600 s); verify gains the budget step
recorded (win32, idle): quick 2.5 s, staged 39.6 s, cold setup 60.2 s (warm store; superseded by the r3 record: quick 2.7 s, staged 49.4 s, cold 81.4 s)
nested SKIP: a step that exits 0 but prints "<tool>: SKIP — why" shows as SKIP (lib nestedSkip); gates.yml runs check-workflows --require-docker on ubuntu
pnpm verify: every step PASS, no SKIP lines (46 s); budget.test (6), ladder.test +1
review r1 pass + 2 minor fixed: review r2 found npm_config_store_dir ignored by pnpm 11 (the 91.9 s run reused the warm store); fixed with pnpm_config_store_dir + --store-dir and a check the temp store was used; install verified cold (reused 0, downloaded 724, 602 MB); review r3: the cold run now measures HEAD + working-tree changes, records that tree's lockfile hash, and the clone checks a provisional record so a lockfile change can be re-recorded; re-recorded 81.4 s; the record carries the pnpm-lock hash and the check fails when it no longer matches

## 2026-09-27 M1.20 (claude)
done: .github/workflows/ci.yml per ci-cd.md §3: verify (ubuntu/windows/macos, pnpm verify), build (uploads packages/apps dist), e2e (chromium/firefox/webkit x 4 shards in mcr playwright v1.63.0-noble pinned by digest; chromium and webkit also run their mobile preset; blob reports), e2e-report (merge-reports json+html, scripts/ci/flake-report.mjs), visual, a11y, size, api (+ changeset status on PRs), license, eval-recorded (explicit SKIP until M14), ci-ok (if: always(), needs every job, scripts/ci/all-green.mjs)
root scripts test:e2e, test:visual (--pass-with-no-tests until @visual specs exist), test:a11y
flake-report fails on flaky, failed, or zero tests run; all-green fails on anything but success (skipped/cancelled included)
local proof: 2 blob shards -> merge-reports json -> flake-report "4 run, 0 flaky, 0 failed" exit 0; test:a11y 1 passed; check-workflows --require-docker: actionlint 0, zizmor 0
ci-workflow.test +7 (job set, ci-ok needs all, OS/engine/shard matrix, image = installed Playwright version by digest, SHA pins in every workflow, run blocks <= 3 lines, flake-report + all-green negatives); mutation (visual dropped from ci-ok needs) fails the test and the gate leg
first push green: pending M1.24 (needs human-authorised push)

## 2026-09-27 M1.21 (claude)
done: security.yml (workflow_call from ci.yml as job `security`, which ci-ok needs; weekly cron): codeql, osv-scanner (lockfile; local run: 963 packages, no issues), dependency-review (PRs), zizmor (check-workflows --require-docker, same digest-pinned images as the ladder)
private repo without GitHub Code Security (security_and_analysis null): CodeQL upload and dependency review would fail, so both run only when repo variable CODE_SCANNING is 'true' and otherwise print SKIP with that reason — human decision: set it once the repo is public or licensed
nightly.yml: properties (FC_RUNS=10000, pnpm test), visual-xos (3 OSes, chromium @visual), mutation/perf/eval-live print SKIP naming M20/M13/M16; report (if: failure(), only job with issues: write) runs scripts/ci/nightly-issue.mjs (one "Nightly failure" issue, commented on when open)
release.yml: permissions {} + job-level contents/pull-requests/id-token write, environment npm, no cache, changesets/action v2 with publish-script `pnpm run release` (new root script); first real publish unverified until npm trusted publishing is configured (human)
renovate.json (renovate-config-validator --strict, renovate 44.115.10: valid, no migration): dashboard approval (every commit needs a task id, so updates are adopted in task commits), minimumReleaseAge 1 day (= pnpm 1440 min), groups per catalog, majors ungrouped, actions/docker digests, playwright npm + image one group, regex manager for check-workflows images
zizmor wants the new `$/` self-repository form, actionlint 1.7.12 rejects it: kept ./ with an inline zizmor ignore; actionlint 0, zizmor 0
ci-workflow.test +5 (only release.yml has id-token/contents write, security/nightly job sets and SKIP reasons, renovate age = pnpm age and regex manager matches both images, nightly-issue dry run); pin and run-block checks now cover every workflow

## 2026-09-27 M1.39 (claude)
first push (f1a1487, human-authorised): gates macos/windows green; ci: verify macos/windows, build, 12 e2e shards, e2e-report, visual, a11y, size, license, security (4 jobs), eval-recorded green; red: verify/gates ubuntu (2 of 404 harness tests; names cut off by the ladder's 40-line tail, and the gates.yml harness step was skipped after the ladder failed), api (build artifact lacked packs/*/dist), release
release: with no changesets changesets/action runs publish, so it tried to publish every @fluxion/*@0.0.0 to npm; all E404 (no credentials), nothing published. The M1.21 header claim "without pending changesets it does nothing" was wrong; the job now needs repo variable RELEASE_ENABLED=true
fixes: release guard; packs/*/dist in the dist artifact; harness-tests step uses the spec reporter and a FAIL detail starts at its "failing tests" list (a long assertion message otherwise fills the 40-line tail; ladder.test +1); gates.yml harness step runs after a ladder failure; ci-workflow.test +2 (guard; artifact covers every pnpm workspace glob; reporter and step condition)
the two ubuntu failures do not reproduce in a node:22.19 Linux container (with CI env vars, no Docker: 400 pass, 4 Docker tests skipped); the next push names them

## 2026-09-27 M1.40 (claude)
second push (4555fa7): api green (packs dist), release skipped (RELEASE_ENABLED unset), all else green except ubuntu verify/gates: workflows.test "passes a minimal clean workflow" and "fails an actionlint error": actionlint could not read .github/workflows/*.yml in the 0700 mkdtemp sandbox (image user != file owner); the ladder's real-checkout workflows step passed (0755)
fix: check-workflows passes --user <uid>:<gid> on POSIX (not on Windows Docker Desktop)
local proof (node:22.19 container as uid 1000, host docker socket, TMPDIR on a path shared with the Docker VM): old code 3 pass / 2 fail with the same "permission denied"; new code 5 pass

## 2026-09-27 M1.24 (claude)
third push (b63650c): ci and gates success on every job (verify and gates on ubuntu, windows, macos; 12 e2e shards; security; api); release skipped (RELEASE_ENABLED unset)
check-ci-evidence.mjs: --record <sha> keeps the successful gates and ci runs of the commit in .harness/reviews/ci-evidence.json; the check re-reads them with gh run view (success, headSha = sha, gates/verify job green on each OS) and requires sha to descend from the M1.21 commit; m1-complete leg added (needs gh)
recorded b63650c (gates 36275476158, ci 36275476410) and verified live; ci-evidence.test (4: pass incl. M1.21 itself, pre-M1.21 fails, red/missing OS job, failed run, other commit, wrong workflow, missing record, --record keeps successful runs)

## 2026-09-27 M1.22 (claude)
README: status (toolchain skeleton), Quickstart (Node >= 22.19, pnpm 11 via corepack; pnpm i, pnpm run setup (also installs Chromium), pnpm verify; review r1: e2e rows say Chromium-only vs all five projects needing `playwright install`) and command table; AGENTS.md commands drop the "[from M1]" markers and add test/e2e/build, check-budget --record, check-ci-evidence --record (106 -> 109 lines)
package map in 01-overview.md compared with tools/gen/workspaces.json dependsOn: consistent for all 19 workspaces; no open quarantines (m1-complete leg PASS)
final review + roadmap split into M1.41: checkFinalReview allows only bookkeeping paths after the reviewed range, so the docs commit must precede the review

## 2026-09-27 M1.42 (claude)
gates.yml windows-latest was cancelled at the 15 min timeout on c5b0b92 and 369a1d7 (b63650c took 13.4 min): ~6 min setup, ladder 438 s, then the standalone harness step reran the suite (it ran on every green ladder before M1.39 too; M1.39 made it also run after failures)
fix: harness step `if: failure()` (names failures in full only when the ladder failed; a green ladder already ran the suite), ci-workflow.test asserts the condition; review r1 F1: a 25-min timeout would loosen the 15-min CI rung budget (ci-cd.md §1), so the timeout stays 15 (windows ~10.5 min without the rerun)
final milestone review ran on aaf09b6..369a1d7; M1.42 is code after that range, so the final record extends to M1.42 with a delta review (M1.41)

## 2026-09-27 M1.41 (claude)
final milestone review (fresh milestone-reviewer) on aaf09b6..369a1d7: F1-F3 major, F4-F6 minor; delta review (fresh) on 369a1d7..c9f4fab: D1, D2 major, D3-D5 minor; record .harness/reviews/milestone-M1-final.json, range aaf09b6..c9f4fab, all majors dispositioned
F1 (dependency review/CodeQL inactive, private repo) and F2 (release enablement) handed to M11; F3/D1 reopened: ci-evidence re-recorded at c9f4fab (gates 36281183585; ci 36281183914 green on attempt 3 after the account's Actions billing block was fixed by the user; attempts 1-2 failed with ci-ok not started for billing), gate tightening handed to M2; F4, F5, D5 handed to M2; F6, D3 argued; D4 fixed (M2 handoffs are rows for the M2 plan)
D2: the draft final-review bookkeeping and roadmap -> M2 went into the M1.42 commit because the local commit helper ran `git add -A`; the helper now stages only the backlog row and state

## 2026-09-27 M2.1 (claude)
m2-complete.mjs written red (1/16 legs green: no quarantines): trace, schema/geometry coverage (≥ 300 statements each + floors, json-summary), NFR-REL-002 at FC_RUNS=10000, fixtures gen --check + named test, v1.0 migration (FR-DOC-003, ≥ 2 tests), NFR-REL-005, API reports (≥ 5 exports) + check-api, diagnostics.md lists every FLX_* code, 3 M1 hand-off legs, verify, backlog, final review, roadmap
test legs count only passing Vitest tests whose full name carries the pattern (json reporter), harness legs only passing node:test cases titled with it
verify leg: every planned step PASS; `workflows` may SKIP only as "Docker not available" (zizmor image host is denied by this machine's egress policy; CI runs --require-docker on ubuntu)
review r1 F1: coverage leg judged the vitest exit (other packages' floors fail it) → tests from the json report, floors from the summary; F2: ci-evidence leg (--milestone M2, M2.20); F3 covered by F2 (the gates run lints workflows on ubuntu)
M1 backlog archived; 24 M2 rows (ADR-0012/0013 first); trace.test "backlog row cites an unknown ID" wrote into M1 rows of the live backlog, now appends its own rows
env: Playwright 1.63 wants chromium-1243; cdn.playwright.dev is denied here, so /opt/pw-browsers/chromium{,_headless_shell}-1243 alias the preinstalled 1194 build (machine-local, not in the repo)

## 2026-09-27 M2.2 (claude)
ADR-0012 accepted: 16-char IDs over `A-Za-z0-9_-` (96 bits) from a `Random` port ({ next(): [0,1) }, `seededRandom` mulberry32 for tests); schema accepts readable IDs (1-64 chars of the same alphabet) for fixtures
own base-62 fractional keys (head char fixes integer length, fraction never ends in 0, first key `a0`); `fractional-indexing` is CC0 = outside LICENSES.allow; no automatic rebalancing (M3 may re-key siblings over 32 chars in one command)

## 2026-09-27 M2.3 (claude)
ADR-0013 accepted: ProseMirror-compatible JSON subset as Zod (doc, paragraph, heading 1-6, bullet/ordered list, listItem, text, hardBreak, field) + marks (bold, italic, underline, strike, code, link, color, highlight, font, size)
review r1 F1: unknown node/mark types are preserved + one warning each (text fallback on render), not errors, so a newer minor never loses text; F2: listItem is paragraph-first, TipTap needs custom marks (color/highlight/font/size) and a field atom in M7; unknown attrs preserved; link.href only http/https/mailto/#screen:<id>; no raw HTML; editor library stays M7 (ADR-0019)

## 2026-09-27 M2.4 (claude)
schema/src/ids.ts: `Random` port, branded `RecordId`, `createId` (16 of `A-Za-z0-9_-`, clamps an out-of-range port), `isRecordId` (1-64 chars, readable fixture IDs), `isGeneratedId` (exactly 16), `seededRandom` (mulberry32)
ids.test: FR-DOC-002 1e6 ids no collision (~0.6 s), pattern property, NFR-REL-005 same seed same ids, whole alphabet used
carried: M2.3 r2 minors (an unknown node satisfies the known content rules; an unknown-node round-trip test) go into M2.7 with an ADR-0013 amendment

## 2026-09-27 M2.5 (claude)
schema/src/fractional-index.ts (ADR-0012 scheme): keyBetween, nKeysBetween (bisection; sequential at an open end), compareKeys (code units), isIndexKey; result.ts: Result/ok/err, FluxError + codes (INDEX_INVALID, INDEX_ORDER, SCHEMA_INVALID, PARSE_JSON, MIGRATION_UNSUPPORTED), Ok/Err
edge found by test: decrementing to the smallest integer `A`+26×`0` gave an invalid key → returns it + `V`; the key space cannot run out, so no exhaustion code
tests: FR-DOC-010 10k pairs between random neighbours, insert-sequence property, nKeysBetween property, one-screen reorder changes one record, edges, never throws on any string
ADR-0012 dated amendment: isRecordId 1-64 vs isGeneratedId 16 (M2.4 F1), growth one digit per ~6 same-spot inserts (M2.2 F1), no exhaustion; index.ts re-exports after VERSION so @packageDocumentation shows (M2.4 F2)
package comment moved to version.ts, the first export of index.ts (biome import sorting suppressed there): tsdown's bundled index.d.ts opens with the first import's region

## 2026-09-27 M2.6 (claude)
zod 4.6.5 via catalog (schema dependency; tech-stack "Schema"); ADR-0014: isolatedDeclarations rejects exported z.infer of unannotated schemas, so record types are TSDoc'd types and `checkedSchema<T>()(schema)` fails tsc unless schema output == T (optional `| undefined` dropped, arrays readonly, branded primitives kept); coding-typescript rule 7 updated
errors.ts holds FluxError + codes (M2.5 F1), only INDEX_INVALID/INDEX_ORDER (F2); M2.5 F3 argued
primitives (recordIdSchema, indexKeySchema, meta, Extensible), paint (TokenRef, Color, ColorValue, gradient/image Paint), records/document, records/screen (kind fixed|infinite, size default 1920×1080, viewport, background Paint)
tests: FR-SCR-001 default size, backgrounds, rejects; FR-DOC-005 unknown keys kept at record and nested level; harness schema-open-objects bans z.object/strictObject/strict/strip/catchall(never) in schema sources
review r1 F1: checkedSchema compared mutual assignability, and Extensible's index signature absorbed one-sided optional fields → identity check on a normalized form (index signature → `__open` key, undefined and readonly dropped) + @ts-expect-error cases; r2 F1: scan reads whole files (split chains), checkedSchema rejects z.object for Extensible types; r2 F2: colour functions need 3-4 numeric channels; r2 F3: infinite screen needs a viewport; F2: screen.notes is now in the M2.7 row; F3: named colours = CSS list
package comment: tsdown dts banner (external imports and re-exported regions precede index.ts's own text in the bundled d.ts); version.ts from M2.5 removed

## 2026-09-27 M2.7 (claude)
style.ts: StyleNumber (number | TokenRef), Stroke, Shadow, Effect (glow/blur), FontStyle, Style, Transform (rot default 0, flips); rich-text.ts: generic ProseMirror JSON type + checkRichText walker (ADR-0013 rules; unknown node/mark = warning, structure = error, unsafe link = error), richTextSchema fails on errors only; screen.notes (M2.6 F2)
tests: FR-DOC-004 `{color` yields one issue at fill; unknown mark one warning at its pointer; unknown node kept and satisfies listItem-first (M2.3 r2 F1/F2, ADR-0013 amendment); NFR-SEC-001 javascript:/data:/vbscript:/`//` links fail; 22 structural error paths in one pass
M2.6 r3 F1: colorValue/paint unions wrapped in checkedSchema; it caught screen.notes present in the type only
ids 1e6 test: 60 s timeout (0.6 s idle, > 5 s under coverage + a parallel agent's load made M2.6's commit fail twice)
review r1 F1: rich-text walker recursed without a limit (20k nested lists = RangeError) → MAX_RICH_TEXT_DEPTH 64, error at the limit; F2: color/highlight marks take hex or token only (ADR-0013); F3: StyleValue<T> exported (StyleNumber = StyleValue<number>)

## 2026-09-27 M2.8 (claude)
records/element-base.ts (shared types), element.ts (kind types), element-schemas.ts (all element schemas; isolatedDeclarations keeps Zod field objects module-private): shape (defId `ns:name`, params, anchors), connector (route straight/curved/orthogonal/polyline/plugin, markers, labels, freeSource/freeTarget), group, frame, text, image (fit default contain), component, plugin kind `ns:name`, and an envelope-only UnknownElement; semantic (slug), locks, placement
records/binding.ts (AnchorRef auto/floating/named/side/point), resources.ts (asset sha256/mime/size, theme DTCG tree, plugin-ref semver/SRI/trust), behaviour.ts (timeline, step, interaction, variable, comment; trigger/action payloads are open `kind` objects until M21-M25)
document-file.ts: schemaForRecord (by type, element kind; plugin kinds known, others envelope-only), anyRecordSchema, documentFileSchema; the 02-document-model example parses unchanged; a shape without defId fails at records/e1/defId
M2.7 r2 minors: "{…" literals are broken tokens (font family, variant, font mark); unknown rich-text nodes get their content/text/marks shape-checked
deps: M2.9 (byte-equal canonical JSON) now after M2.11 (the serializer); M2.10 after M2.8

## 2026-09-27 M2.15 (claude)
geometry drafted by a worktree subagent (uncommitted), integrated row by row; this row: result (Result/GeometryError, code MATRIX_SINGULAR), vec2, mat2d (SVG order a b c d e f; multiply(m, n) applies n first; invert → Result, |det| < 1e-12 singular), box (fromPoints/union/intersection/contains/inflate/corners/transformBox), element-transform (local 0..w,0..h → screen: flips, rotation about centre, translation; elementBounds/elementCorners)
tests: FR-SHP-001 transform ∘ inverse = identity ε 1e-9 (property), rotated bounds contain 4 corners (property), 90° corner mapping, flips, singular → error; 100 % lines/branches
package comment as tsdown dts banner (same fix as schema); the worktree under .claude/worktrees is excluded locally (.git/info/exclude) — biome/knip scanned it
review r1 F1/F2: arbitraries were fc.double (mostly tiny values; a wrong invert and TL/BR-only bounds passed) → 1e-3-grid coords, well-conditioned composed matrices, integer sizes, quarter-degree angles, exact inverse example, four-edge tightness; both mutants now fail on seeds 1-3; F3: singular threshold relative to entry scale

## 2026-09-27 M2.25 (claude)
checkpoint cp1 (fresh milestone-reviewer, 1a9aa22..4c8a58a): F1, F2 major; F3-F5 minor; recorded .harness/reviews/milestone-M2-cp1.json; F1/F3 → M2.25, F2 → M2.26 (ADR-0142, no parse-time defaults), F4 → M2.10 acceptance, F5 → M2.23
m2-complete: vitestNamed escapes the title for -t (literal), legs match the plan's exact titles (NFR-REL-002 fuzz, FR-DOC-003 migration, fixtures), NFR-REL-005 needs a passing case in schema and in geometry, one leg runs the M2.9-M2.17 acceptance properties by title; v1.0 fixture path under src/ (package rootDir); gate 2/18 green (was 3/16: the bare-ID NFR-REL-005 leg no longer passes on ids.test)
ADR numbering: plans reserve 0014+ per milestone and unplanned decisions use 0137+, so M2.6's ADR-0014 → ADR-0140 (dated amendment), M2.17's dependency ADR → ADR-0141
review r1 F1: the fuzz leg requires parse-robust.test.ts to assert its run count against fc.readConfigureGlobal().numRuns with no local numRuns (M2.14 row widened); F2: the v1.0 leg needs three titled cases (older fixture migrates, v1.0 validates, idempotent; M2.12 row quotes them); F3: M2.16 row quotes the gate titles

## 2026-09-27 M2.26 (claude)
ADR-0142 (M2 cp1 F2): no schema fills defaults or transforms values; screen name/kind/size, document title, transform.rot, image and image-paint fit, comment resolved are optional with the default in TSDoc; accessors screenSize/screenKind/transformRotation; the unmodified 02 §7 example now parses unchanged
anyRecordSchema is a custom + superRefine that re-adds the inner Zod issues unchanged (M2.8 F1: too_small at records/e1/transform/w survives the dispatch)
schema-open-objects scan also bans .default/.prefault/.catch/.transform; tests retitled with Renames-test (document minimal "validates unchanged"; transform "optional rotation (read as 0)")

## 2026-09-27 M2.10 (claude)
validate(doc): shell (object, schemaVersion vs 1.0: invalid/older/newer major = error, newer minor = warning, records object), per record in id order (id/key mismatch, schemaForRecord safeParse → FLX_SCHEMA_INVALID or the rich-text FLX code, enum hints, unknown type/kind warnings, rich-text warnings of text/notes/labels), then references.ts (one document record, themeId, screen master/parent/background asset, element screenId/parent container on same screen/cycles/asset refs, bindings to connectors + duplicates, connector ends bound or free, timeline/step/interaction/comment targets, duplicate sibling index warning, duplicate slug)
references resolve against every present record: a record failing its schema is not also reported "missing" by its referrers
diagnostics.ts: 24 FLX_* codes with severities (mapped type over the code union), jsonPointer (RFC 6901); docs/reference/diagnostics.md documents each
fixtures src/__fixtures__/invalid/{references,structure,hierarchy,connectors,version} with hand-written expected code/severity/path lists (tsconfig includes src/**/*.json); M2.26 note: its retitled tests went through Removes-test, not Renames-test (bodies changed)
review r1 F1: rich-text warnings come from the raw record, so a record with schema errors keeps them (structure fixture gains the t1 unknown-mark warning); F2: referential checks see records under their map key; F3: enum hint asserted (binding end); F4: no-document fixture
review r2 F1/F2: document count and bound connector ends use every present record (valid or not), so a record failing its schema causes no FLX_DOCUMENT_MISSING or FLX_CONNECTOR_END_MISSING; F3: harness diagnostics-doc.test ties DIAGNOSTIC_CODES to the reference tables (code + severity, both directions)

## 2026-09-27 M2.11 (claude)
serialize.ts: serializeDocument (keys sorted at every depth, numbers on the 1e-3 grid, -0 → 0, 2-space indent, LF, trailing newline; undefined fields dropped, undefined array items null), canonicalNumber; parseDocument(text) → Result<{ document, diagnostics }, DocumentError (FluxError DOCUMENT_JSON_INVALID | DOCUMENT_INVALID + diagnostics)>: JSON errors as FLX_JSON_INVALID (new code, documented), then validate(); the typed document comes from documentFileSchema (no cast) and equals the input (ADR-0142)
tests: FR-DOC-001 parse(serialize(doc)) deep-equals doc over the §7-style doc with random JSON extras on every record (property); NFR-REL-005 twice byte-identical and independent of key order; exact output layout; rounding; parse never throws on bad JSON
salvage of valid records on failure is M2.14; the arbDocument form of the round-trip property arrives with M2.13
review r1 F1: canonical() built objects with a prototype, so a "__proto__" key in unknown data was dropped on save → Object.create(null) + test; F2: parseDocument returns the project Result (rule 10)

## 2026-09-27 M2.9 (claude)
preservation.test: FR-DOC-005 byte-equal canonical JSON after parse+serialize for a document with an unknown record type, a plugin kind with props, an unknown element kind, unknown fields at top level / on records / inside transform, style, font, settings and gradient stops, an unknown rich-text node and mark (and the four warnings it reports); property: an extra field at record/transform/style/font depth survives
M2.11 r2 minors: canonicalNumber keeps |n| ≥ 1e12 as is (idempotent; no overflow to Infinity), property over every double
preservation needed no schema change: looseObject everywhere (M2.6), no parse-time defaults (ADR-0142), prototype-free output (M2.11)
review r1 F1: the byte-equal case compared schema output with schema output → also asserts JSON.parse(text) and the parsed document deep-equal the raw input; F2: 08-file-format canonical rule notes the ≥ 1e12 exception
review r2 F1: every number was rounded, so plugin props and unknown fields lost digits (51.50735 → 51.507) → only geometry is rounded (transform x/y/w/h/rot, free ends, waypoints, label offsets, screen size/viewport), everything else exact; 08-file-format §4 says so; preservation tests use non-grid numbers and arbitrary doubles
a random-seed run found -0 in extra data written as 0 (the canonical rule) → named example case; the property generator excludes -0; 10 random seeds and FC_RUNS=5000 green

## 2026-09-27 M2.12 (claude)
migrate.ts: Migration {from,to,up}, MIGRATIONS (empty: 1.0 is the only released version), migrate(doc, chain) → Result<{document, applied}> (MIGRATION_UNSUPPORTED for malformed/newer-major/no path/wrong output/looping chain; current or newer minor returned unchanged, so idempotent); RawDocument records are unknown
repair.ts: dangling binding → removed, connector end free (screen centre when it had none); missing or looping parent → screen root; missing/invalid/shared sibling index → appended; each FLX_REPAIRED_* warning (3 new codes, documented); pure (JSON clone)
parseDocument = JSON → migrate → repair → validate; released fixture src/__fixtures__/v1.0/document.flux.json (every record type, canonical form) validates and round-trips byte-equal
tests: FR-DOC-003 synthetic 0.9→1.0 (dimensions → size, z → index) migrates and validates; v1.0 fixture 0 diagnostics; migrating twice = once; refusals; repair cases; parse repairs on load
M2.9 r3 minor: M2.md, M12.md and the M2.11 row now say geometry-only rounding
review r1: records null made parseDocument throw in repair (typeof null === object), and array records were rebuilt as a map → migrate/repair need plain-object records, anything else goes to validate (FLX_RECORDS_INVALID); tests for null, array, string

## 2026-09-27 M2.13 (claude)
entry `@fluxion/schema/testing` (exports ./testing, tsdown entry testing/index; fast-check a regular dependency via catalog (the entry imports it at runtime; as a peer or devDependency dependency-cruiser flags it), kept out of the main bundle): documentBuilder({seed, title}) with screen/rect/text/connect/build (ids from seededRandom, indices appended per sibling group, bound or free connector ends), plainText; arbitraries arbDocument (valid by construction via the builder: screens, shapes, texts, bound connectors, unique slugs, geometry on the 1e-3 grid) and arbRectOptions
tests: FR-DOC-001 every generated doc validates with 0 errors (≥ 1000 runs), parse(serialize(doc)) deep-equals doc over arbDocument (M2.11's planned form), deterministic builder output
review r1 F1: arbElement added ({element, document}: shape, text or free-ended connector in a one-screen doc; property checks all three kinds validate); F2: entry comment says fast-check is a regular dependency

## 2026-09-27 M2.14 (claude)
parseDocument never throws: JSON → depth guard (MAX_JSON_DEPTH 256, iterative; deeper is FLX_JSON_TOO_DEEP, new documented code) → migrate → repair → validate; DocumentError.salvaged = the records with no error at or below /records/<key> (null for non-JSON, too deep or unmigratable input)
parse-robust.test: NFR-REL-002 fuzz over binary strings, random JSON, truncated/spliced/garbage-inserted serialized arbDocuments and records replaced by random JSON; counts its runs and asserts the count equals fc.readConfigureGlobal().numRuns (no local numRuns); FC_RUNS=10000 passes in ~5 s (120 s timeout for slow runners); salvage property (one broken element, the rest kept verbatim); 100 000-deep nesting reported
M2.12 r2 minors: freed ends go to the viewport centre on infinite screens; an end still held by another binding gets no free point
review r1 F1: freeEnd scanned all records per removed binding (30k dangling bindings ~24 s) → bindings counted per end once, linear test; F2: salvage now drops a record's dependants too (repair + validate to a fixed point), so the salvaged records validate; a dropped connector takes its own bindings
review r2 F1: a broken binding was dropped without freeing its end, so salvage then lost the valid connector → dropped bindings go to repair as dangling (end freed); property over broken bindings; F2: stale comments in repair.ts

## 2026-09-27 M2.16 (claude)
path.ts: PathCommand (M/L/Q/C/Z) → cubic-normalized Path (lines at 1/3, 2/3; quads degree-elevated; Z closes only when needed), PATH_* error codes (GeometryErrorCode extended), pointAt/derivativeAt/splitAt, tight segment/path bounds; path-sampler.ts arc-length LUT; nearest.ts coarse samples + golden-section refinement; intersections.ts segment/segment and cubic/cubic by bbox subdivision (one piece split per level), deduped and x/y sorted; point-in-path.ts nonzero/evenodd on the flattened outline
tests: FR-CON-001 properties (bbox contains samples, intersection symmetric + on both paths, a line built across a curve finds the crossing point, nearestPoint beats every sample) over grid-based pathCommands; 120 s timeouts on the properties
M2.15 minors: invert TSDoc states the relative threshold; a matrix with det ≈ 1 on entries of 1e7 is singular (distinguishes relative from absolute)
ladder budget (staged run 176 s > 120 s): repair grouped siblings by copying the array per record (quadratic: 40k records 8.4 s) → push; the coverage-floor sandbox runs properties at FC_RUNS=10, FC_SEED=1 (floor mechanics, not property depth)
review r1 F1: coincident curves subdivided to eps-flat pieces (radius 1000: 32 767 points in 4 s; 1e5: minutes) → near-parallel pieces that lie along each other (ends and midpoint on the other) are pruned; identical arcs report none, a half arc one point, at radius 10, 1000 and 1e5; F2: point-in-path flattened 32 steps per cubic (a radius-1000 circle misclassified points 0.3 inside) → exact: y-monotone pieces, ray crossing found by bisection on the curve; test at 0.05 in and out of a radius-1000 circle
ladder budget, again 123 s after r1 (harness-tests 121 s the critical path): the coverage-floor cases share two sandbox runs (all floors met with cli uncovered; core, render, player, editor uncovered at once) instead of one run each; every case keeps its title and package-specific assertion; the suite runs in ~16 s
review r2 F1: the overlap check ran nearestPoint at every near-parallel node (concentric arcs 1e-3 apart: 2.3 s; r=1e4 2e-6 apart: 15 s) → onSegment is a chord-line bound plus 8 Newton steps (a miss only splits further, never prunes wrongly), and a fat-line test separates pieces lying wholly outside the other's chord band; concentric arcs at r up to 1e5, gaps 1e-3 and 0.1: 0 hits in ms (test with a 5 s timeout); gaps within ~eps still cost down to eps-flat pieces (TSDoc says so)

## 2026-09-27 M2.17 (claude)
ADR-0141: rbush 4.0.1 (MIT, dep quickselect ISC) and flatbush 4.6.2 (ISC, dep flatqueue ISC) as geometry runtime dependencies (catalog; @types/rbush dev only, rbush ships no types), bundled by the player
spatial-index.ts: SpatialIndex (size, search → ids sorted by code unit, collides), createDynamicIndex (rbush: insert replaces an id, remove, clear) and createStaticIndex (flatbush, built once; empty handled since flatbush needs ≥ 1 item); last item of a repeated id wins in both; edge/corner contact intersects in both
tests: NFR-REL-005 both adapters (bulk, incremental, static) equal a brute-force scan over random boxes and queries; removals keep dynamic equal to a static index of the rest; touching boxes, replace/remove/clear, empty static index

## 2026-09-27 M2.18 (claude)
scripts/fixtures/gen.mjs [--check] builds fixtures/docs/*.flux.json from the @fluxion/schema/testing builders (reads dist; canonical text): minimal, two-rects-line, unknown-kind (plugin kind + unknown fields), invalid-ref-missing, invalid-schema-invalid; --check fails on a missing, stale or foreign fixture
fixtures-docs.test (schema): "fixtures/docs behave as named" — the exact set, each ≤ 50 kB, valid ones parse with no error and are canonical, invalid-<code> fails with FLX_<CODE> (Vite glob ?raw import: the fixtures sit outside src)
check-tests-kept: deleting or renaming away a released fixture (fixtures/docs, fixtures/v<x>/, __fixtures__/v<x>/) needs Removes-test; editing a versioned fixture always fails (contracts.md rule 10); harness case
carried minors: M2.14 r3 — a removed binding with a corrupted end frees neither connector end (was: source); M2.17 — ADR-0141 records that rbush ships no types (@types/rbush dev dependency)
gate fixes before review: the coverage sandbox copies fixtures/ (the fixtures test runs there too); knip entry scripts/fixtures/*.mjs
review r1 F1: a Removes-test trailer excused editing a versioned fixture → such edits fail whatever the trailer (like a false Renames-test); harness asserts the edit with Removes-test still fails

## 2026-09-27 M2.19 (claude)
determinism.test (schema): "NFR-REL-005: repeated runs are identical" — per arbDocument and seed, serialize, parse (valid, truncated, dangling binding), validate, repair, migrate, 20 seeded ids and fractional keys run twice and compare as exact JSON text (key order included)
determinism.test (geometry): same title — per random paths, point and matrix: bounds, sampler length and samples, nearestPoint, intersectPaths, pointInPath (both rules), invert, element matrix/bounds/corners, dynamic and static index queries, twice, exact JSON
no Math.random/Date in pure packages: already enforced by the biome override (no-math-random.grit, no-wall-clock.grit, noRestrictedGlobals) on packages/{schema,geometry,...}/src
carried M2.18 r2 minor: check-tests-kept fails, whatever the trailer, a rename into/out of/within a released versioned fixture folder and a new file in an existing one (a new version folder is fine); harness asserts all three

## 2026-09-27 M2.20 (claude)
check-ci-evidence --milestone M<n>: the recorded sha must be at or after M<n>'s final review range end, or before that review exists HEAD's last commit touching a non-bookkeeping path (BOOKKEEPING_PATHS from milestone-checks.mjs); without --milestone the M1 --after rule is unchanged
ci-runs.mjs: runs read through gh when installed, else the GitHub REST API mapped to the gh run view shape (Bearer GITHUB_TOKEN only when set, never logged); fetch/spawn injected, tests use fakes (no network)
harness cases: a sha before the final review range end fails even with green runs; at/after passes; no final review → last non-bookkeeping commit; REST mapping, 404, auth header only with a token, gh preferred when present
live check (no gh here): REST reached the M1 evidence through the agent proxy (NODE_USE_ENV_PROXY=1, NODE_EXTRA_CA_CERTS)
carried M2.19 minor: a rename into a new (unreleased) version folder is allowed; the rule applies only when the destination folder already exists

## 2026-09-27 M2.21 (claude)
cold-setup job in ci.yml (fresh ubuntu runner, no dependency cache): check-budget --cold runs the isolated cold setup (fresh clone + working-tree changes, empty pnpm store and PLAYWRIGHT_BROWSERS_PATH, pnpm i --frozen-lockfile → pnpm run setup → pnpm verify) and fails above COLD_SETUP_MAX_MS (unchanged, 600 000); ci-ok needs it; the threshold check is one function shared with --record
budget.test "record isolation": a fake pnpm on PATH checks call order, a fresh store and browsers path per run (store empty before install), the clone outside the working tree, the uncommitted lockfile reaching clone and record, a provisional record seen by verify, temp dir removed; a run whose install leaves the store unused fails; --cold passes without writing and fails on a failing verify
not done here: re-recording .harness/budget.json — the cold run in this container cannot download Chromium (network policy blocks cdn.playwright.dev); the record still predates the lockfile (blockedReason until a human allows the host or records elsewhere)

## 2026-09-27 M2.22 (claude)
one three-OS verify: gates.yml is one ubuntu job without install (workflow lint + one `node scripts/gates/check-commits.mjs --range "$BASE..$HEAD_SHA"` call); ci.yml's verify matrix is the only three-OS ladder and now also names failing harness tests on failure (M1.39 behaviour kept)
check-commits.mjs: an empty or all-zero base falls back to the baseline commit (--baseline for tests); harness cases for the fallback, "commit messages checked by script" (single call, only ci.yml runs the ladder on 3 OSes)
check-ci-evidence: ci's verify must pass on every OS and one gates job (`gates`, or the pre-M2.22 `gates (ubuntu-latest)`); merged with M2.20's --milestone/REST changes
M2.21 review minor: state.json blockedReason records the budget re-record blocker (cdn.playwright.dev denied here)

## 2026-09-27 M2.23 (claude)
02-document-model: §1.4 record types are hand-written and checked against the schemas (ADR-0140); new §1.6 parsing fills no defaults, readers use screenSize/screenKind/transformRotation (ADR-0142); schemaVersion lives on the file (§2, §4); catalogue synced with the schemas (optional marks, missing fields added, fields the schemas lack moved to "Planned", table kind noted as R3/unknown until then)
schema and geometry READMEs describe the M2 public surface with an example (geometry example run against dist)
docs-consistency: catalogue record types = RECORD_TYPES (table and RecordType union), core kind rows = ELEMENT_KINDS, every listed key field exists in that record's schema shape (element base fields against the core kinds' union); shown to fail on a bogus field and on a planned field listed as a key field
schemaForRecord and RecordSchemaChoice exported from @fluxion/schema (already @public in document-file.ts; additive) so the harness can read the schema shapes from dist; API report regenerated (now references zod's ZodType)

## 2026-09-27 M2.24 (claude) — final review recorded, milestone not closed
final milestone review (fresh milestone-reviewer, 1a9aa22..5481b86): changes-requested; F1 major reopened as M2.27 (blocked on a human: budget re-record needs cdn.playwright.dev, plus the decision whether CI's same-run cold-setup measurement satisfies the budget step in CI, with an ADR); F2 argued; F3, F4, F5, F7 handed to M3 and F6 to M11 (plans + roadmap Deferred table); M2 Learned filled
m2-complete: every leg PASS except verify (budget step only), CI evidence (nothing on main yet), backlog (M2.24 waits on M2.27) and roadmap; the roadmap stays on M2 until M2.27 is done

## 2026-09-27 M2.28 (claude)
first CI on main (4967ed7): everything green (cold-setup job included) except verify on 3 OSes — ubuntu at the budget step only (M2.27); macOS and Windows also failed the M2.21 "record isolation" case: macOS compared /var/... with /private/var/... (the fake pnpm now records resolved store/browser paths, raw --store-dir kept for the args check); Windows cloned with the runner's core.autocrlf, so the clone's lockfile hash (CRLF) differed from the working tree's (the cold clone now passes --config core.autocrlf=false)

## 2026-09-28 M2.27 (claude)
budget re-recorded on the owner's Windows machine (cdn.playwright.dev reachable): quick 18 389 ms, staged 86 637 ms, cold setup 130 130 ms at 8e0195d, current lockfile; state.json blockedReason cleared
ADR-0143 (human decision 2026-09-28): inside CI (CI=true|1) the budget step notes, not fails, a record older than pnpm-lock.yaml, because the same run's cold-setup job measures that lockfile; limits and the missing-record rule still apply; locally a stale record still fails
budget.test: "lockfile change in CI" (CI=true passes with the note, a staged-time breach still fails, CI=false fails); the budget helper pins CI so an inherited CI=true on runners cannot turn the "predates" case vacuous; ci-cd.md cold-setup comment cites ADR-0143

## 2026-09-28 M2.29 (claude)
delta milestone review (fresh, 5481b86..23a6cf0): pass with D1 major (ADR-0143 said the staged hook re-records; precommit runs budget only in --all), D2 minor (completion gate inherits CI=true), D3 minor (cold setup measured on ubuntu only)
fix: ADR-0143 Consequences corrected (stale record surfaces at the next full verify/completion gate; ubuntu-only measurement); m2-complete verify leg runs pnpm verify with CI unset; proof: stale record + CI=true → check-budget exits 0 with the ADR-0143 note, with the gate's CI='' it exits 1
D1 residual (agent-runnable re-record) and D3 handed to M3 (M3.md + roadmap Deferred); milestone-M2-final.json dispositions use `hand-off` (the gate rejected `hand off`)

## 2026-09-28 M2.24 (claude) — M2 closed
second delta review (fresh, 23a6cf0..1262dea): pass, E1-E4 minor; final record range now 1a9aa22..1262dea with D1-D3 and E1-E4 dispositioned (D1/D2 reopened as M2.29, done; D3, E1-E3 handed to M3; E4 fixed here); M2.29 review F1/F2 argued (same M3 hand-off)
M2.24 and M2.29 done; roadmap Current milestone -> M3; CI evidence re-recorded at 1262dea, the range end (gates 36357856795, ci 36357856939, verify green on 3 OSes); review r1 F1 (close only with evidence) fixed by recording it in this commit

## 2026-09-28 M3.1 (claude)
M2 backlog archived (docs/backlog/archive/M2.md); 25 M3 rows: plan 16, ADR-0014 its own row, 6 M2 final/delta hand-offs (M3.3-M3.8), checkpoint cp1 (M3.18), docs split from the final review
m3-complete.mjs red (2/22): test-backed legs by the exact titles the rows quote (Vitest JSON report, full name), harness hand-offs by named node:test cases, bench leg reads vitest bench --outputJson (an `undo <id>` and a `redo <id>` benchmark for each of the 8 built-in commands, each p99 <= UNDO_MAX_MS; review r1 F1), verify leg also needs the M3.15 `kind-switch` step; the CI-evidence leg passes now (no M3 code commits yet) and turns red with the first one
M3.3's type test lives in core (geometry may not import schema)
review r1 F2/F3: the NFR-REL-003 leg requires core/src/undo-property.test.ts to count runs against the global numRuns with no local numRuns (M2.25 F1) and reruns both titles at FC_RUNS=1000
review r2: the r1 edits were applied by a script that dropped regex escapes and missed the bench filter; fixed by hand and checked (a valid readConfigureGlobal().numRuns source passes; numRuns: / numRuns : / { numRuns } overrides are caught; bench leg requires all 16 undo/redo names)

## 2026-09-28 M3.2 (claude)
ADR-0014 accepted: transact returns Result (rollback on invalid data or hook depth; a throw rolls back and rethrows), net diffs (create+delete absent, deep-equal writes dropped, empty diff silent), hooks sorted by key to a fixed point (8 passes, TX_HOOK_DEPTH) and skipped on undo/redo, history = inverse diffs + opaque metaBefore/metaAfter, merge only same key + no commit in between + not sealed (no time window), fork = O(1) snapshot with parent copy-on-write, read-only policy → TX_READ_ONLY
03-core-engine §1: transact signature returns Result<R, TxFailure> and points at ADR-0014; index row added
review r1 (6 findings): merge also needs the same origin; metaBefore/metaAfter come from the caller for this transaction (cross-screen undo); nested transact returns a provisional ok, outermost opts win; transact callers are command run, core history and core fork apply; copy-on-write on both sides; rows M3.14/16/17/19/20/22 cite ADR-0014

## 2026-09-28 M3.3 (claude)
ADR-0144: one Result shape (Ok/Err, ok(value), err(error)) repeated in each L0 package that needs it (geometry may not import schema); geometry Result<T, E = GeometryError>, err takes one error object, GeometryError/codes moved to geometry/src/errors.ts; coding-typescript rules 10/12 amended (each package lists its codes in its own src/errors.ts)
core depends on @fluxion/schema and @fluxion/geometry (workspace:*; lockfile importers only); result-convention.test.ts: toEqualTypeOf + runtime values; note: geometry's old Result<T> was already structurally equal to schema's Result<T, GeometryError>, so the type test pins the convention rather than failing on the old code; the substantive changes are err's signature and the per-package errors.ts
geometry API report regenerated (Ok, Err exported; errors.ts); argued M3.2 minors carried in this commit
first cross-workspace import exposed two harness sandbox leaks: linkInstalls junctioned whole workspace node_modules, so @fluxion/* links escaped to the real repo (Windows: C: temp + E: path in dependency-cruiser); it now links entry by entry with @fluxion/* pointing at the sandbox copies. api.test fullCopy builds the copied workspaces (tsc -b) because TypeDoc follows project references into .tsbuild, which sandboxes do not copy
40-traceability Tests column rewritten (check-trace --write: NFR-MNT-007 now named)

## 2026-09-28 M3.4 (claude)
verifyLeg(required, {command, cwd}) in milestone-checks.mjs: runs `pnpm verify` with CI unset, tolerates only the Docker SKIP, needs PASS for every required step; m3-complete uses it (kind-switch in its step list)
verify-leg.test: "stale budget record fails the shared verify leg under CI=true" (control: the budget step alone passes with the inherited CI=true; through verifyLeg it fails with "predates"); mutation check: dropping the CI unset turns the case red; step/SKIP handling case
ADR-0143: Considered Options 1 and Consequences reworded, and an Amendments section records this and the M2.29 correction (documentation.md rule 8); M3.4 review argued lines from M3.3 carried

## 2026-09-28 M3.5 (claude)
ADR-0145 (extends ADR-0143): the staged ladder runs the budget step when pnpm-lock.yaml is staged (check-budget --staged); `--record --cold-pending` measures quick/staged and carries the previous cold number as coldSetupSource pending-ci (accepted by the staged ladder and CI, rejected by a local full ladder and verifyLeg); after the push `--record --cold-from-ci <sha>` takes the cold-setup step duration of that commit's green ci run (lockfile must match), coldSetupSource ci:<run id>; no windows/macos cold-setup job (ubuntu is the reference; verify jobs bound the others)
design note: a staged-lockfile rule alone would have blocked agents without Chromium from committing a lockfile change at all (the CI number only exists after the push), hence the pending state
ci-runs REST mapping keeps job steps with times (ci-evidence REST test expects steps: []); budget.test +3 cases (CI run, pending, staged lockfile); AGENTS.md command line added
review r1: F1 --record times the ladder with --no-budget (with the lockfile staged the nested staged ladder ran the budget step against the old record and nulled stagedMs; the stub ladder now logs its args and the test asserts --no-budget); stale-record message names --cold-pending; F2 the staged-lockfile case uses a workspace so the step really runs: pending record PASS (via --staged), old record FAIL, --no-budget absent
review r2 F1: the staged-lockfile case pins CI (it passed an old record under an inherited CI=true); the whole budget suite passes with CI=true and unset
CI was red at 3a2f055 (verify x3, build, cold-setup): the docs build's TypeDoc (and check-api's) reads the .tsbuild declarations of project references, which a fresh checkout lacks since core imports schema/geometry (M3.3); fixed here: turbo @fluxion/docs#build depends on @fluxion/core#typecheck, and the ladder runs typecheck before the build barrier; fresh simulation (all .tsbuild deleted): turbo build --filter=@fluxion/docs --force green
review r3 (cap reached): F1 the CI api job also ran TypeDoc on a fresh checkout: it now runs pnpm run typecheck before check-api (fresh simulation: typecheck then check-api, 17 reports match); F2 check-budget --staged ignores an inherited CI=true (staged case asserts FAIL budget under CI=true). A 4th round is an exception to the 3-round cap, decided by me after the user delegated the choice ("you decide, don't ask me", 2026-09-28)

## 2026-09-28 M3.6 (claude)
docs-consistency both ways (M2 final F4): unknownCatalogueFields checks the element row against the fields every core kind has (intersection); missingCatalogueFields requires every required schema field (id/type excepted) in the record row, for element kinds in element row + kind row; both named cases also show the helper reporting a planted gap (element.transform, asset.hash, element(shape).defId)
02 catalogue: the element row listed transform and text?, which connector lacks (the new intersection check reported element.transform and element.text on the old text); they move to each boxed kind's row, with a note in the element row

## 2026-09-28 M3.7 (claude)
check-ci-evidence (M2 final F5): reading a run no longer exits on a transport failure; the failure is one more reported problem next to the floor/record problems (a runs-file entry with `error` simulates it); transportHint (ci-runs) appends "HTTPS_PROXY is set, but Node fetch ignores it unless NODE_USE_ENV_PROXY=1" for REST reads behind a proxy (not for gh); the list path (--record) fails with the same hint
"stale sha reported with a transport failure": red on the old code (the exit hid the floor error), green now; hint unit case

## 2026-09-28 M3.8 (claude)
"FR-DOC-005: the unknown-kind fixture parses with FLX_KIND_UNKNOWN" was red on the M2 fixture: its only unknown element was acme:gauge, a plugin-qualified kind the schema accepts as a plugin element (FLX_KIND_UNKNOWN is for unqualified kinds from a newer version); gen.mjs adds a `hologram` element (future core kind, extra field) so the fixture is what its name says; regenerated, --check current, schema suite 110 pass
budget record refreshed with ADR-0145's CI path: check-budget --record --cold-from-ci 268b58e (ci 36378108726, cold setup 156 s; first green CI after M3.3's lockfile change); M3.7 review minors argued

## 2026-09-28 M3.9 (claude)
core ports (ports/ports.ts): Clock (now, frame → cancel), TextMeasurer (FontSpec → TextMetrics), FileIO (Result<…, CoreError>), Hasher (sha256 hex), Logger (log(level, message, fields)); Random re-exported from schema; CoreError/CoreErrorCode in core/src/errors.ts (ADR-0144)
@fluxion/core/testing (own tsdown entry and exports path, like schema's): VirtualClock (moves only on advance; frames requested during a frame run on the next advance), FixedTextMeasurer, MemoryFileIO (copies in and out), CaptureLogger, seededRandom (schema's); 5 tests incl. the gate's NFR-REL-005 title; core API report regenerated

## 2026-09-28 M3.10 (claude)
alien-signals 3.2.1 (MIT, catalog pin; ADR-0002 names it; first third-party runtime dependency of core, so of the player later) behind core/src/signals.ts: ReadSignal, computed, effect, batch (public), writable (internal)
RecordStore/createStore: records copied (JSON clone: pure packages have no structuredClone) and deep-frozen; get/has/size/ids/record$ (one lazy signal per record)/toDocument (envelope kept); `apply(puts, deletes)` is core-internal (transactions, M3.11) and notifies each changed record once in a batch; 4 tests incl. the gate's NFR-MNT-006 subscriber title
budget re-recorded locally (lockfile staged: the staged ladder now requires it, ADR-0145): cold setup 86.8 s; lessons: record only after staging new files (the cold clone applies `git diff HEAD`, which omits untracked files), and a failed --record writes nulls the next attempt's harness test reads (restore budget.json first)
coverage.test "fails when a pure package is below the floor" relied on core being a stub: one uncovered 6-line function no longer dragged core under 90 %; the fixture now adds 400 copies

## 2026-09-28 M3.11 (claude)
Store.transact/subscribe (ADR-0014): WorkingCopy (get sees own writes; put copies and deep-freezes; patch shallow-merges, undefined removes, id/type change or a missing record throws), netDiff (create+delete and deep-equal writes drop out; empty diff silent), nested calls join (provisional ok, outermost options), a throw rolls back and rethrows; TX_INVALID/TX_HOOK_DEPTH/TX_READ_ONLY codes
validation: changed records through schema's new validateRecord (the per-record half of validate), then validateReferences (the cross-record half) over the post-state, rejecting only referential errors the pre-state lacked (so deleting a screen that strands elements fails until M3.14's hooks; a document's existing dangling ref does not block unrelated edits); StoreOptions.validate=false for production builds
tests: NFR-MNT-006 property (arbDocument × random patch/delete/recreate: diff replays pre→post exactly, no no-op entries, rollback leaves no trace), rollback title, referential, throw, net, nested, frozen, option; mutations (no-op puts, validation skipped) caught; M3.10 F1 fixed: deepFreeze descends into already-frozen objects
review r1: F1 created records now committed and asserted (put without before; re-put after delete); the property re-puts the original value even after a delete; F2 nested transact is a savepoint (ADR-0014 Amendments): an inner throw drops only the inner writes; F3 known-error key includes the message (a reference moved to another missing id is new); the O(N) referential pass per transaction is measured by M3.23 (argued)

## 2026-09-28 M3.12 (claude)
Indexes (byScreen, byParent: elements; byType; bindingsByElement) built at load and updated inside RecordStore.apply (not by a subscriber: M3.11 review F1), with a version signal per index key; Store.members(index, key) reads a key (subscribing in a reactive context), Store.query(fn) is a memoized computed that re-runs only when a record signal or index key it read changes
tests: NFR-MNT-006 property (arbDocument × one transaction per op: delete/restore/unparent/move-screen, validation on and off; store snapshot == indexes rebuilt from toDocument) — mutation (old keys never removed) caught; members; query re-run counting; M3.11 review F2 fixed: a Tx used after its transaction throws "transaction is closed"
review r1: F1 index version bumps no longer read the version signal (plain counters beside the signals): an effect that transacts no longer subscribes to the keys it bumped; test with an outside watcher, red under the tracked read; F2 bindings are filed under their connector too (members(bindingsByElement, connector) = both ends)
review r2: F1 Store.query(fn) now hands fn a tracked ReadView (get/has via record signals, ids/size via a membership signal bumped on add/remove, members via index keys); a get-based query re-runs on a rename, add and delete (red with an untracked get); F2 per-key counters exist only for keys with a signal (argued: signals exist only for keys someone read)

## 2026-09-28 M3.13 (claude)
Registry<K,V> (createRegistry): register(key, value, source) → Result<Disposable, Diagnostic>; the same source replaces its entry, another source is refused with FLX_REGISTRY_DUPLICATE (new schema code, documented in diagnostics.md "Engine") and the first entry stays; dispose is idempotent and removes only the still-current registration; get/source/list (sorted by key)/changes$ (bumped by set only, never a tracked read)
CORE_REGISTRY_NAMES (the 15 of 03 §4) and createCoreRegistries(); value types opaque (Registry<string, unknown>) until the consuming packages define them; 5 tests incl. both gate titles

## 2026-09-28 M3.14 (claude)
IntegrityHook(context: tx, pending net diff, members(index,key) incl. the transaction's own writes); StoreOptions.hooks (a Registry); transact runs them after fn, sorted by key, until a pass writes nothing (compared by reference), at most 8 passes → TX_HOOK_DEPTH, never for undo/redo; hook lookups use an untracked Indexes.peek; CoreRegistries.integrityHooks typed
built-ins (registerCoreHooks, source core): screens (elements, timelines, steps), subtrees (whole subtree of a deleted element in one pass, so nesting deeper than the pass limit works: M3.2 F4), bindings (connector deleted → its bindings; bound element deleted → binding deleted and the end freed at the element's centre; binding deleted → its end freed unless still held)
tests: the gate's FR-EXT-001 property (arbDocument × random deletes of any non-document record: every transaction commits and validate() has 0 errors), cascades, 12-deep group, key order, TX_HOOK_DEPTH, undo/redo skip; mutations (no free-on-unbind, no subtree hook) caught; 03 §4 Registry signature synced (M3.13 review F1)
review r1: F1 ownedHook: a deleted record takes its steps (timeline), interactions (owner) and comments (target); screen masterId/parentElementId are cleared; an asset/theme still in use is refused by validation (test); the property now enriches arbDocument with interactions, comments, timelines+steps and screen master/parent refs (red without ownedHook); F2 HookContext.deleted includes records created and deleted in the transaction (WorkingCopy.dropped, kept by savepoints); F3 pending records indexed once per hook pass
review r2 F1: ownedHook follows owned chains with a worklist in one pass (a 12-deep reply chain on a deleted element commits; red without the worklist)

## 2026-09-28 M3.15 (claude)
check-kind-switch.mjs, the `kind-switch` step of every ladder mode: in core/render/editor/player/exporters shipped sources (tests, stories, benches, fixtures excluded), a `switch (x.kind)` / `switch (kind)` or an `else if (x.kind ===` fails; comments and strings are blanked first; `// kind-switch-allow: <reason>` exempts a line for closed unions
kind-switch.test: real sources pass; the gate's "switch on el.kind in render fails" (exit 1, file:line); else-if chain and bare switch fail; comment/string/test/allow-listed do not count
review r1: F1 chains are two or more kind-vs-literal comparisons (either operand order, === or !==) within 10 lines, so early-return and ternary chains fail too; strings keep their quotes when blanked so literals stay visible; F2 the switch subject may contain calls and indexing; one guard alone stays allowed
review r2: F1 an else-if whose condition compares a kind (either operand order) is a chain however long the branches (14-line bodies case); F2 el["kind"]/el['kind'] are read as el.kind before strings are blanked
