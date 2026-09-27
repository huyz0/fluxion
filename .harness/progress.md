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
