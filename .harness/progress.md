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

## 2026-09-28 M3.16 (claude)
CommandDef<A> (id, MessageDescriptor title, args: ArgsSchema<A> = the safeParse shape Zod schemas satisfy, optional when, run → the transaction Result), defineCommand, executeCommand(registry, ctx, id, args): unknown id → COMMAND_UNKNOWN/FLX_COMMAND_UNKNOWN, when false → COMMAND_DISABLED/FLX_COMMAND_DISABLED, schema failure → COMMAND_ARGS with one FLX_COMMAND_ARGS per issue at /args/<path>; nothing runs in those cases; codes documented in diagnostics.md "Engine"
typing: ZodType<never> is not covariant, so args is structural and AnyCommand = CommandDef<unknown> (run is a method: bivariant parameter); core registries moved to core-registries.ts so registry.ts stays a leaf (no commands↔registry cycle); zod is a core devDependency (tests) until M3.17's built-ins use it at runtime
TypeDoc needs docs on every member: ArgsParsed/ArgsRejected/ArgsIssue are named, documented types; budget re-recorded for the lockfile change (zod devDependency): cold setup 97.3 s

## 2026-09-28 M3.17 (claude)
CORE_COMMANDS + registerCoreCommands (source core): element.create/update/delete, screen.create/delete, screen.reorder ({id, after?}: keyBetween the neighbours, computed before the transaction; patches only the moved screen: FR-DOC-010), binding.set (re-points the end's binding or creates one; clears that end's free point), document.update; args are Zod schemas (zod becomes a core runtime dependency: catalog pin, MIT, already in schema); record bodies are only identity-checked by args, fully validated by the transaction
registerCoreHooks and registerCoreCommands return the refused registrations as diagnostics (M3.14 review F1)
architecture test (tests/harness/architecture.test.mjs; a first Vitest version raw-imported every source through import.meta.glob, which made v8 coverage drop untested files, found when coverage.test "below the floor" went green; m3-complete runs the harness case by name): outside core history.ts/fork.ts, every `.transact(` in packages/*/src and packs/*/src shipped sources is `ctx.store.transact(` (a command's context); red on a planted direct call; budget re-recorded for the lockfile
review r1: F1 create commands refuse an existing id and binding.set a taken new binding id; F2 update/delete/reorder/binding.set refuse ids of another record type (TX_INVALID + FLX_COMMAND_ARGS at the argument path; store unchanged); F3 the architecture matcher also catches destructured and computed-key transact calls (the ctx.store naming loophole stays a lexical limit, argued)

## 2026-09-28 M3.18 (claude)
cp1 (fresh milestone-reviewer, a34a9c3..0fc444d): changes-requested, F1-F3 major, F4-F7 minor; record .harness/reviews/milestone-M3-cp1.json
reopened: M3.26 (F1 named-case discovery, F4 built-ins throw on untrusted fields, F5 value fixed point, F6 gate scopes); rows amended: M3.19/M3.20 (executeCommand carries TxOptions; merge and meta tested through element.update; empty-diff merge rule), M3.22 (fork.diffFrom), M3.23 (benches with validation on, transact-5000 leg, ADR-0014 cost amendment); M3.md Learned filled
cp1 plan review r1: the amended acceptance is now quoted titles with m3-complete legs (meta and merge through commands, empty-diff merge, diffFrom, hook settle, identity field in fields, routing kind-switch and app direct-write fixtures); the bench leg checks undo-5000 and transact-5000 (transact <id> benchmarks) and refuses validate:false in bench sources; M3.24 depends on M3.26

## 2026-09-28 M3.26 (claude)
cp1 fixes: F1 docs-consistency imports the schema dist at module level, so the catalogue describe is synchronous and its named cases are found under --test-name-pattern (both now report tests 1 / pass 1); F4 `fields` refuses id/type keys (FLX_COMMAND_ARGS at /args/fields/<key>), document.update without a document and screen.reorder with an unknown after return diagnostics; F5 the hook fixed point compares values (jsonEqual), so a hook re-writing a correct value settles in 2 passes; F6 check-kind-switch scans every package but schema/geometry plus all packs and apps (17 workspaces), the architecture test scans apps too; negative cases for routing and an app
review r1 F1: the bench leg scans every file under packages/core/bench for validate:false (M3.23 row amended), replacing the argued M3.18 F2 line that promised it

## 2026-09-28 M3.19 (claude)
history.ts (one of the two modules ADR-0014 lets call transact; the store hands it a bound transact): Store.history with undo/redo (ok(metaBefore)/ok(metaAfter), HISTORY_EMPTY, or the replay transaction's failure), canUndo/canRedo, undoDepth/redoDepth; the store records user/system commits right after apply, before subscribers; undo/redo replay the diff's before/after snapshots with origin undo/redo (validated, hooks skipped, not re-recorded); a new recorded commit clears redo; remote commits are not recorded
cp1 F2: CommandContext.options carries TxOptions from executeCommand's caller into run (a fifth executeCommand parameter hit the lint cap); every built-in writes through one `write(ctx, label, fn)` helper that passes them
tests: the gate's undo/redo exactness title (six built-ins incl. a cascading delete, stepwise snapshots both ways), the meta title through element.update, recording rules, 250-deep history; mutation (undo skips restoring deletes) caught

## 2026-09-28 M3.20 (claude)
merging (ADR-0014 §Merging): a recorded commit merges into the open entry only with the same mergeKey and origin, the open entry still the latest, and no seal() since; any other commit (incl. undo/redo/remote) closes it; the merged entry keeps each record's first before and latest after, drops records that net to nothing and is removed when the whole gesture nets to nothing; label and metaBefore from the first, metaAfter the latest; no clock involved
decided (M3.2 F3): an empty-diff transaction is never recorded, so it does not break a merge
history.seal() and history.batch(label, fn, options) (one transaction around commands, whose nested transacts are savepoints; in history.ts, one of ADR-0014's allowed callers)
tests: the gate's 60 element.update commands through executeCommand with a mergeKey = 1 entry (undo returns the first metaBefore, redo the last metaAfter), the empty-diff title, interleaving/seal/key/origin/undo breaking the merge, a net-zero gesture, batch; mutation (merge disabled) caught

## 2026-09-28 M3.21 (claude)
undo-property.test.ts: arbDocument × up to 12 generated built-in commands (all eight, args resolved against the current state, some merged under their command id, refusals part of the model) with the core hooks; full undo equals the initial document, redo-all the final one; both properties count their runs against fc.readConfigureGlobal().numRuns and set no local count (FC_RUNS=1000: 3 pass in 1.9 s); a deterministic case shows the model commits (not all refusals)
mutation (undo skips restoring deletes unless the diff also has puts) caught in 38 ms at FC_SEED=1; M3.20 review minors fixed: per-step metaBefore (undo returns the first), undo+redo then a same-key move starts a new entry

## 2026-09-28 M3.22 (claude)
SharedRecordMap (record-map.ts): stores share one record map, the first writer copies (sharers count); Store.fork() is O(1) (shares the map, own signals/history, indexes built lazily) and holds an extra share of its fork-time base, so every writer copies while the snapshot is needed; fork.diffFrom(parent) = net change against that base (undefined for any other store); forks are read-write
fork.ts (ADR-0014's other allowed transact caller): applyFork(parent, fork, label, options) writes the fork's diff into the parent as one user transaction (validated, hooks run, one undo step); the parent's concurrent edits to other records survive; where both changed a record the fork wins (documented)
policy 'read-only': transact returns TX_READ_ONLY with FLX_READ_ONLY (new schema code, documented), executeCommand refuses before when/args; transact's commit half moved to #commit (complexity); M3.21 review F1 fixed (redo property asserts each undo)
tests: the gate's three titles (fork isolation both ways incl. indexes/history, diffFrom keeps concurrent edits, read-only element.update), forks of forks; mutation (no copy on write) caught

## 2026-09-28 M3.23 (claude)
packages/core/bench: fixture.ts (5 001-record document from the schema builders: 10 screens × 250 rects + 83 bound connectors; createStore with default options, validation on, core hooks; one succeeding argument set per built-in command, a refused command throws), undo-5000.bench.ts (undo/redo <id>; beforeEach puts the entry on top, only the step is timed), transact-5000.bench.ts (transact <id>; afterEach undoes)
Vitest 5 moved benches into tests (`context.bench(name, opts, fn).run()`, JSON reporter `assertionResults[].benchmarks[].tasks[].latency.p99`, project "node (bench)"); the m3 gate's bench leg was written for the old `--outputJson` and is updated (also fails on a failed bench test); `async: false` because tinybench otherwise calls the function once outside the hooks; root `pnpm bench`
results: all 24 p99 5.4–9.1 ms (≤ 16); ~5 ms floor = whole-document referentialErrors per validated transaction → ADR-0014 Consequences corrected + amendment (cp1 F3). Bench files sit outside tsc -b (src only); typechecked once ad hoc, clean

## 2026-09-28 M3.24 (claude)
03-core-engine §1–§4 rewritten from the API report: Store/Tx/Diff/CommandDef/Registry blocks copy the real signatures; prose covers createStore options, transact order (hooks → validation → commit/fail with codes), subscribe after history, forks/diffFrom/applyFork, executeCommand refusal order, CORE_COMMANDS, History members and merging, core registries (render/editor registries named as packages, not APIs), check-kind-switch
harness case "03 names core exports" (sync describe): parses core.api.md (exports, aliases, interface/type members, schema imports, string literals); in 03 §1–§4 every declared interface/type must be an export and each member a member of it, every prose code span that is an identifier or call must be known; a mutated doc (Store.frobnicate, renderAll()) is reported. It found `fn`/`err` in prose, reworded
core README (status, usage, links) and AGENTS invariants (transact callers, Result, frozen/COW, exact undo, hook fixed point, validation on, error codes, benches)

## 2026-09-28 M3.25 (claude)
m3-complete before the final review: 18/23; beyond the expected review/CI/backlog/roadmap legs, check-trace --milestone M3 failed: NFR-PERF-006 is named only by the bench tests, which check-trace did not scan (TEST_FILE .test/.spec). Vitest 5 benches are tests (context.bench inside test), so check-trace now reads *.bench.* titles too; trace.test adds "fails naming an unknown ID cited in a Vitest bench title"
final review (fresh milestone-reviewer, a34a9c3..040a7ad): pass, six minors (bench leg only in m3-complete, undo/redo origin through commands, no wired bootstrap, no core determinism test, argument error codes, lexical write-path test), all handed off to M4 (M4.md "Handed off from M3", roadmap Deferred). CI evidence at 040a7ad (all jobs green on three OSes). tzap trial (user decision: tzap replaces StrykerJS) over M3's lines: 84.0% (187 survived, 78 of them message strings) → M4 first row. Roadmap to M4.

## 2026-09-28 M4.1 (claude)
m4-complete.mjs (red) from the plan's legs + the seven M3 final hand-offs (F1-F6, tzap); legs whose helper/artefact is missing fail with a reason (benchLeg looked up dynamically; built CLI checked before spawning); vitestNamed/namedCases/titled moved from m3-complete into milestone-checks.mjs (Vitest project option for the T1 browser titles); M3 backlog archived; 25 rows (resolved style lives in theme: core may not import theme; CLI e2e folded into each command row; tzap ADR + triage rows; core mutation target 90 % after triage)

## 2026-09-28 M4.2 (claude)
ADR-0015 static render path: react-dom/server renderToStaticMarkup of <ScreenView mode="export">; content CSS a string module in @layer fx.content inlined by ssr.ts (no CSS Modules loader; ADR-0010 amended: layer name + string module); Node TextMeasurer fixed metrics (R0 views do not measure); resolveStyle in theme wrapped in core computed by render (core may not import theme); shape view looks defId up in shapeDefs (fixtures use basic:rect); mode read only in mode-policy.ts

## 2026-09-28 M4.3 (claude)
ADR-0146: tzap (@huyz0/tzap 0.1.1, Apache-2.0, catalog pin, root devDep, knip-ignored like other path-invoked tools) replaces StrykerJS; ADR-0008 amended; tech-stack/testing/ci-cd/01/M20/NFR-MNT-005 wording/AGENTS.md/tdd skill updated
scripts/harness/mutate.mjs (`pnpm mutate [--package <dir>] [--from <ref>] [--out-dir] [--check]`): tzap discovery sees one root Vitest package (test.projects), so the script narrows the model's sources to the chosen packages and pins model.root to the repo (a model's root is relative to its file); per-package score from the report; --check against .harness/baselines/mutation.json floors (whole-package runs only)
core measured 83.7 % (1 174 valid, 182 survived, 9 uncovered, 75 s) → floor 83.7; nightly mutation job runs `pnpm mutate --check` and uploads the report; check-drift also refuses a lowered/removed floor (harness cases "a lowered mutation floor fails", raise/add passes)
review F1/F2: `--to=-Local-` (tzap parses `-Local-` as a flag otherwise) and a stale tzap.json is deleted before the run; any tzap exit other than 0/1 (or a signal) is a failure; tests/harness/mutate.test.mjs: a diff-scoped run writes a fresh report, a failing run exits non-zero and leaves no stale report

## 2026-09-28 M4.4 (claude)
CommandTxOptions (TxOptions without origin undo/redo) types CommandContext.options; executeCommand also refuses those origins at run time (COMMAND_ARGS, FLX_COMMAND_ARGS at /options/origin) for untyped callers; built-ins' missing/wrong-typed ids and "a screen cannot follow itself" return COMMAND_ARGS (TX_INVALID stays for invalid documents); keyBetween failure names the neighbour's index (FLX_INDEX_DUPLICATE / FLX_SCHEMA_INVALID); applyFork misuse carries the new FLX_FORK_UNRELATED (documented); ADR-0014 amendment, 03 §2, API reports
tests: the gate's three titles + equal-neighbour-keys case + @ts-expect-error on CommandTxOptions; a test command in commands.test now forwards ctx.options (it silently dropped them)
review F1-F3 (round 2): store.transact itself refuses undo/redo origins (FLX_ORIGIN_RESERVED; history replays through #replayable), so a command's run cannot forge them; a malformed neighbour key is named on its holder; FLX_INDEX_DUPLICATE keeps its registered severity
round 3: history.batch runs through the store's checked transact (StoreHistory takes transact + replay); only undo/redo use the unchecked replay; forged-batch test; the hooks-skip test now drives history undo/redo (the direct undo-origin calls it made are refused now)

## 2026-09-29 M4.5 (claude)
createCore(file, options?) (bootstrap.ts): core registries with CORE_HOOKS and CORE_COMMANDS registered, store created with the hooks registry, `execute(id, args, options?)`; README and 03 §1 use it
tests: "FR-EXT-001: the core bootstrap cascades a bound shape delete" (registries hold the built-ins; delete of a bound shape frees the connector end, 0 validation errors), options threading (read-only, system + mergeKey merge); "NFR-REL-005: the same command sequence twice gives equal diffs, history and document" (arbDocument × ≤10 generated commands, diffs serialized with entry order, results, history depth, document; asserts some commits happened) + a case showing Map toEqual ignores order while the serialized form does not

## 2026-09-29 M4.6 (claude)
architecture.test: comments and strings are blanked first; then every mention of `transact` outside history.ts/fork.ts is a stray (a call, .call/.apply/.bind, an alias, destructuring, a computed key), except `ctx.store.transact(` where the nearest ctx parameter is a `run`'s or typed CommandContext; store.ts may only declare it (`transact<R>(`); named cases "transact through call, apply or bind fails", "a ctx-named helper outside a command fails", plus the declare-only store case; the repo passes
review round 1 (F1-F5): the check now walks the TypeScript syntax tree (TS 6 compiler API from the repo's single TS 6 pin, apps/docs): identifiers/strings named transact are strays except a direct ctx.store.transact(…) whose ctx resolves by scope to a defineCommand run parameter or a listed CommandContext helper (builtin-commands write); declares mode allows only method declarations; cases for template expressions, regex backticks, scoped const ctx, non-defineCommand run, unlisted helper, Reflect/variable string keys, typed call in store.ts
review round 2: parse .ts as TS (TSX misread builtin-commands' generic arrow as JSX and hid everything after it) and fail on parse diagnostics; the repo case appends a stray to builtin-commands and must see exactly it; ctx shadowing by destructuring, for-of, catch or reassignment in a run is not the command's context

## 2026-09-29 M4.7 (claude)
milestone-checks.mjs: BENCH_COMMANDS/BENCH_FILES, checkBenchReport(report, maxMs) (tests passed, one `<undo|redo|transact> <id>` per built-in, p99 ≤ max; missing p99 fails) and benchLeg(maxMs, {runner, root}) (bench files exist, no bench-folder file switches validation off, runs Vitest 5 bench JSON); m3-complete and m4-complete use it; ADR-0014 M3.23 amendment says what runs
tests/harness/bench-leg.test.mjs: "a bench over UNDO_MAX_MS fails the shared leg" (report + leg with a fake runner), missing name / failed test / missing p99, validation off before running, missing file
also carries the argued M4.6 F1 line
review F1/F2: the validation-off scan walks the bench folder recursively (nested helper case); cases for a passing report with a non-zero exit and for no output. Real runs of benchLeg(16) failed 2 of 3 at tinybench's 1 s default (a p99 over ~190 samples at ~5 ms is one or two GC/scheduler pauses: 19.2 / 20.0 ms on different ops); RUN_OPTIONS (3 s + 0.5 s warm-up, ~600 samples) in the bench fixture: 3 of 3 pass, 171 s each

## 2026-09-29 M4.8 (claude, triage by a subagent, verified)
core mutation 84.2 % → 100.0 % (1 242 valid, 0 uncovered; re-measured independently): ~160 survivors killed by new tests (command title ids/labels, undo/redo labels, hook keys/source, failure messages name the command, diagnostics non-empty, the 8 NoCoverage: fork deletes, unsubscribe, patch identity, dropped), 4 message mutants disabled, 12 equivalent ones disabled with reasons (bindingsHook early free, pendingMembers, counters, no-hook fast path, patch's closed check)
production simplifications that survivors proved redundant (no behaviour change): indexAfter default/ternary, binding.set unconditional free clear, ownedHook unreachable guard + lazy pointers, freeEnd redundant undefined check, indexes snapshot/add-bump, registry list via compareKeys, diffFrom jsonEqual, history mergeKey always held; floor 83.7 → 100

## 2026-09-29 M4 cp1 (claude)
fresh milestone-reviewer over 5832cef..b26cf09: changes-requested, F1 (SSR styling unchecked) and F2 (ladder budget) major, F3-F9 minor; F1/F8 amend M4.16/M4.22, F1-F3/F8 gate and ladder work in new M4.26 (before M4.11), F4-F7 in new M4.27, F6 commit type and F9 argued; M4.md Learned
cp1 disposition review round 1: M4.26 acceptance catches F2 (scoped staged tests, suite rows re-record the budget) and names its gate legs; M4.27 acceptance checks the ADR amendments

## 2026-09-29 M4.9 (claude)
@fluxion/theme: DTCG-shaped Token/TokenGroup/Theme types and themeSchema (Zod; tokens are objects with $value/$type: color, dimension {value, unit: px}, fontFamily, fontWeight, number; names letters/digits/_/-; issue paths point into the tree), LIGHT_THEME (every FR-THM-001 colour role, heading/body/mono families, font size/weight/line-height, space, radius, stroke; shape/connector defaults with token refs for M4.10), resolveToken (TOKEN_UNKNOWN / TOKEN_NOT_A_VALUE; own properties only), cssVarName, cssValue, toCssVars (one --fx-<path> per token, tree order); errors.ts per ADR-0144; deps schema + zod (lockfile, budget re-recorded)
tests: the gate's two titles + roles, schema refusals, paths/values; theme coverage 100 % (50 statements; M4.10 adds resolveStyle)
review F1-F3: themeSchema refuses tokens sharing a CSS variable; colours are schema's colorSchema (now exported from @fluxion/schema); family names refuse control chars and <>, and every non-generic name is quoted with \ and " escaped; the package comment is a tsdown dts banner

## 2026-09-29 M4.10 (claude)
theme resolveStyle(style, kind, theme, at): per field, first of element literal/token ref → defaults[kind].variants[variant] → defaults[kind] → defaults['*'] (globals) → built-in fallbacks; token refs as var(--fx-<path>, <theme value>); transformed tokens as color-mix in OKLCH (lighten with white/black, alpha with transparent); gradients with resolved sorted stops, image paints, transparent/none as no fill; paints tagged `type` (kind-switch gate reads .kind); unknown tokens → FLX_TOKEN_UNKNOWN (new, documented warning) at the style's or the theme default's pointer, next layer used
tests: the gate's two titles (property: a literal beats any token default; element token beats defaults), layers, paints, stroke/font; theme coverage 99/94 % over 140 statements
review F1-F4: 02 §Style and an ADR-0015 amendment state the defaults shape (variants, '*' globals) and that every emitted value is validated; resolveStyle emits only schema colours, quoted/escaped family names, allow-listed keywords and finite numbers, else the next layer; a gradient with < 2 resolved stops falls through; FLX_TOKEN_UNKNOWN has its own 'Styles and themes' section with both path kinds
review round 2 F1-F3: refs must match the strict token syntax; a token's value must pass the token schema (isValidToken) before resolveStyle or toCssVars emit it (an unparsed theme object cannot inject CSS); transform numbers finite and clamped; stop offsets finite and clamped, others dropped

## 2026-09-29 M4.26 (claude)
ladder-scope.mjs: staged mode runs the harness files a commit can affect (all when a staged path is neither source nor bookkeeping; the source-reading architecture/docs-consistency/kind-switch/workspace-shape for a sources-only commit; none for bookkeeping) and a Vitest run scoped to it (skipped when nothing Vitest reads is staged; node project only, coverage limited to non-browser workspaces, when no browser-tested workspace or dependency is staged); --all, CI and gates run everything. titled() batches one Vitest run per project/env (vitestTitles). m4-complete: the ssr leg names the M4.16 CSS/vars and SSR-browser parity titles; the demo leg uses checkDemoHtml (each screen: a shape .fx-el[data-kind], a connector path, a var(--fx-…)). Harness cases in ladder-scope.test.mjs
measured: harness suite ~97-109 s when all 30 files run in parallel on this machine (contention; lower --test-concurrency is slower); a sources-only commit skips ~26 of them
review F1/F2: SOURCE_HARNESS adds bench-leg, diagnostics-doc, schema-open-objects (they read the real schema/bench); SAMPLE_HARNESS (api, ladder, mutate, packages) names the files that use a package only as sample material, covered by the typecheck/api/publint/attw steps; a pin case fails on any harness file reading package paths that is in neither list; the node-only coverage include uses the config's *.{ts,tsx} pattern
review round 2 F1-F2: the pin also matches variable joins and workspace loops (join(REPO, dir…), workspaces.map((w) => w.dir), ...workspaces); coverage joins SOURCE_HARNESS (real sources, node-only floors no other staged step judges); SAMPLE_HARNESS adds layering (layering step), licenses, adapters, turbo (non-source files whose change runs the whole harness)

## 2026-09-29 M4.27 (claude)
cp1 F4-F7: bench-leg case "bench commands match the built-in commands" (BENCH_COMMANDS and the bench fixture's COMMANDS equal core dist's CORE_COMMANDS ids); the NFR-REL-005 determinism property generates every CORE_COMMANDS id (create, screen.create, binding.set added, with fresh ids and kind-filtered picks) and asserts each committed at least once; ADR-0014 amendment: p99 5.65–9.17 ms at 3 s sampling (worst undo screen.delete, means ≤ 7.1 ms); ADR-0146 amendment: nightly runs whole pure packages, split per package past 45 min, re-measure floors after a tzap upgrade (lowering only with Threshold-change and triage)

## 2026-09-29 M4.11 (claude)
@fluxion/render: <ScreenView store screenId mode view theme editOverlay> (fit view: .fx-view box, .fx-screen at logical size with the theme's CSS vars and translate/scale fit, background/content/overlay layers, overlay in edit only, data-interactive in present; infinite screens show their viewport), mode-policy.ts (RenderMode incl. export/thumbnail; modePolicy → editOverlay/interactive/measure), content-css.ts (CONTENT_CSS in @layer fx.content, injected once in the browser), useValue (useSyncExternalStore over a core effect), fit.ts (screenArea, fitTransform); render deps: schema (added to workspaces.json dependsOn and the 01 overview), core, theme, react, react-dom (lockfile; budget re-recorded)
check-mode-policy.mjs (ladder step mode-policy; harness mode-policy.test.mjs, in SOURCE_HARNESS): no comparison/switch/condition/index on the mode outside mode-policy.ts
tests: T1 "FR-SCR-001: a 1920x1080 screen fits a 960x540 box at scale 0.5" + letterbox, vars/overlay/interactive/style-once, reactivity; node fit/area/policy/CSS; render coverage 100/96
coverage.test's dropBrowserCovered also removes the package entry's re-exports of the modules it drops (render's index re-exports screen-view); use-value.browser.test.tsx tests the hook's re-render (and keeps the harness convention: a module covered only in the browser has a browser test of its name)
review F1-F4: the mode gate ignores optional members/parameters (mode?:) and ?? defaults, and now catches destructuring renames, computed ['mode'] keys, membership (includes/has) and method calls on the mode; its header states the limits; React is a peerDependency of render (one React per host), react and react-dom devDependencies until SSR uses react-dom/server
review round 2 F1: the React peer is a range (^19.0.0), not the catalog's exact pin that publishing would write; the dev copy stays on the catalog

## 2026-09-29 M4.12 (claude)
theme: resolveBackground(background, theme, at) (colour/gradient/image/token; theme default defaults.screen.background = {color.background})
render: background.ts paintCss (resolved paint → background CSS; an image is a hatch placeholder until M10, its asset id a data attribute, never CSS); DocumentView renders screens by screensInOrder (fractional index, id tiebreak); ModePolicy.showHidden (edit only)
tests: T1 "FR-SCR-001: renders each background kind" and "FR-SCR-001: screens render in fractional-index order" (reorder command, hidden in present vs edit); node paintCss/screensInOrder

## 2026-09-29 M4.13 (claude)
render: registries.ts (createRenderRegistries → elementViews: Registry<kind, ElementView{Component}>), elements.tsx (ElementList: the visible elements of a screen root or group/frame, by fractional index; each a .fx-el[data-el-id][data-kind] wrapper placed at its box, rotated about the centre, flips; view looked up in the registry, re-rendering on registry changes; PlaceholderView role=img "Unsupported element: <kind>" for unregistered kinds); screen-order.ts elementsInOrder; ScreenView/DocumentView take registries (default empty); .fx-placeholder in CONTENT_CSS
tests: T1 "FR-DOC-005: an unregistered kind renders a labelled placeholder and keeps the record", registered view + re-render + duplicate refused, order/nesting/hidden; node elementsInOrder, createRenderRegistries
review F1-F2: members of a group/frame are stored in screen coordinates, so their list sits in a .fx-members container that inverts the parent's placement (offset, rotation about its centre, flips; test with an offset rotated flipped group); the placeholder keeps members outside its img role

## 2026-09-29 M4.28 (claude)
M4.14's staged ladder (lockfile, API reports and an ADR staged: the whole harness plus the browser Vitest run) measured 86-126 s against 120 s. Profile: harness files alone sum to ~246 s sequential, api.test (~30-45 s) and budget.test (~19-45 s) the longest; the full harness alone runs in ~44 s wall, so the overrun is contention with the browser test run and the package-hygiene steps
api.test: the passing real-repo case and the undocumented-export case share one full copy (before/after), the edit restored after its case; 24 s instead of 30 s

## 2026-09-29 M4.14 (claude)
render: ShapeView (kind shape): the defId's outline from the render-level shapeDefs registry (ShapeOutline → geometry PathCommands → pathData, rounded 1/1000 px) as an SVG path over the wrapper's box; fill (colour, linear/radial gradient defs; images M10) and stroke from theme resolveStyle; centred plain-text label (plainParagraphs) in the resolved font; unknown defId → PlaceholderView. basic-rect.ts BASIC_RECT; builtins.ts registerBuiltinViews/builtinRegistries (source core), ScreenView's default; ElementViewProps gains theme and registries; render depends on geometry (lockfile; budget re-recorded: staged 107.5 s after M4.28, under 120 s; the ≤ 84 s target of the lockfile rows is M4.29, before M4.16)
path-data.ts switches on a path command's closed union (kind-switch-allow)
theme: LIGHT_THEME defaults['*'].font = body font, md size, normal line height, text colour
ADR-0015 amended: render-level shapeDefs in R0; core shapeDefs typed with the basic pack (M5)
tests: T1 "FR-SHP-001: rendered bounds equal the transform", "FR-SHP-001: rotation is about the center", fills/dash/unknown def; builtins registration; node pathData, BASIC_RECT, plainParagraphs
review F1-F5: budget re-measured after M4.28 (the packet's own ladder had run 126 s); the rotation test also measures the drawn outline; gradient stops keyed by position (hard stops share an offset); gradient ids unique per mounted view (useId), tested with one record drawn in two views

## 2026-09-29 M4.15 (claude)
render: connector-ends.ts connectorEnds(view, id): a bound end starts at the bound element's centre (rotated corners from geometry elementCorners) and is clipped where the centre line leaves its outline (intersectSegments); a free end is freeSource/freeTarget; undefined when an end cannot be placed. ConnectorView draws the straight line (pathData) in screen coordinates from a store query (moving a bound shape redraws), stroke from resolveStyle 'connector', end/start markers from a marker table (arrow; the markers registry arrives in M5), marker ids per mounted view; registered as a built-in; .fx-el defaults to left/top 0 so a boxless connector wrapper sits at the origin
anchors read as auto until M5, non-straight routes and waypoints draw straight until M9
tests: T1 "FR-CON-001: renders straight line between bound shapes" (ends on the borders ±0.5 px, marker, theme stroke, redraw on move), free ends/rotated clip/no arrow, delete frees the end at the centre; node connectorEnds
backlog: M4.30 added (M4.14 review F1, gradient parity between shape fills and backgrounds)

## 2026-09-29 M4.30 (claude)
render shape-view: gradient fills in user space and following CSS: linear through the centre at the paint angle over the CSS gradient-line half-length (abs(w cos a) + abs(h sin a))/2, radial a farthest-corner circle (r = hypot(w, h)/2); coordinates rounded to 1/1000 px
tests: T1 "FR-SHP-001: a gradient fill matches the background gradient of the same paint" (screenshots of a 400x100 screen with the paint as background vs as a covering shape's fill, 21 interior samples, linear 45° and radial, max channel difference ≤ 2); fails on the previous bounding-box gradients

## 2026-09-29 M4.29 (claude)
ladder-scope.mjs: lockfileWorkspaceOnly(before, after) (equal outside the importers: section, CRLF-insensitive); harnessFiles classifies each staged path: sources and API reports → SOURCE_HARNESS, workspace package.json or a workspace-only lockfile → MANIFEST_HARNESS (SOURCE_HARNESS + every harness file naming package.json/pnpm-lock/pnpm-workspace: adapters, budget, ci-workflow, layering, licenses, packages, test-titles, turbo, verify-leg), the traceability matrix → trace, bookkeeping → nothing, anything else → all; testScope drops a workspace-only lockfile from the global Vitest inputs (its package.json scopes the run). precommit computes the option from HEAD:pnpm-lock.yaml vs the index
probe (render/src + render/package.json adding a workspace link + the lockfile, --no-review --no-budget): staged ladder 35.7 s (harness 30.1 s, test 13.7 s, attw 33.0 s) against 100-126 s before; lockfile checks: M4.14 and M4.11 lockfile changes are workspace-only, the tzap addition is not
tests: ladder-scope cases for each class, lockfileWorkspaceOnly unit cases, the manifest-reader pin; ci-workflow's precommit pin follows the new call
review F1: lockfileWorkspaceOnly also compares each importer's resolved external dependencies (importer, name, version; links and the dependency kind left out), and a lockfile counts as workspace-only only when a workspace manifest is staged with it; cases for a lockfile-only commit and an importer's external version change. Rechecked: M4.14's lockfile is workspace-only, M4.11's (render gained external react) and the tzap addition are not

## 2026-09-29 M4.16 (claude)
render: ssr.ts renderDocumentToHtml(file, {screens?, theme?, registries?}): createCore, the export-mode visible screens in order (screensInOrder with modePolicy('export').showHidden), each the live ScreenView (mode export, fit box = the screen's own size) through react-dom/server renderToStaticMarkup; one HTML page: doctype, escaped document title, <style data-fx-content> CONTENT_CSS, a page style stacking screens, no script; react-dom is a peer (^19.0.0) beside react (the lockfile is unchanged: peers are not locked)
tests: node "FR-CLI-001: static HTML has no script and one .fx-screen per visible screen" (hidden skipped, screen filter, escaped title, byte-stable, fixture shapes and connector), "FR-THM-001: the static HTML inlines the content CSS and defines every --fx variable it uses"; T1 "FR-SCR-001: SSR markup equals the browser render for each fixture" (every visible screen of the valid fixtures; styles re-serialized by the browser, attributes sorted, useId ids numbered)
ssr.browser.test.tsx carries ssr's stem, so the coverage sandbox drops ssr.ts with its node test (ssr imports the browser-covered screen view)
budget re-recorded: staged 39.1 s (≤ 84 s, M4.29 scoping), quick 8.5 s, cold 96.5 s
review F1-F2: each screen's renderToStaticMarkup gets identifierPrefix s<index>- (separate renders restart useId, so gradient and marker ids repeated across screens); node case: two screens with gradient shapes and arrows have unique ids and each url(#id) resolves inside its screen (fails without the prefix); the parity describe no longer cites FR-EDT-010 (edit vs present parity is M6)

## 2026-09-29 M4.17 (claude)
ADR-0147 (CLI v0 contract): fluxion <command> [options] with strict node:util.parseArgs per command, global --help/-h, --version, --json; exit codes 0 ok, 1 input errors, 2 usage, 3 internal (FR-CLI-005 adopted early); --json prints one envelope {schemaVersion 1, command, ok, exitCode, diagnostics (schema Diagnostic), result?} described by specs/cli/output.schema.json; usage errors are FLX_CLI_USAGE (schema DIAGNOSTIC_CODES, new "Command line" section of docs/reference/diagnostics.md)
cli: main.ts run(argv, io) with the command table (validate and render listed; they exit 3 "not available" until M4.18 and M4.20), bin.ts (#!/usr/bin/env node, package.json bin fluxion → dist/bin.js, tsdown entry), index exports run/CliIo/CliOutput/ExitCode; cli depends on schema (workspaces.json dependsOn, 01 overview, tsconfig reference; the lockfile change is a workspace link)
tests: e2e/cli.usage.test.ts spawns dist/bin.js: "FR-CLI-001: --help lists validate and render", "FR-CLI-001: an unknown flag exits 2" (+ --json envelope valid against the schema), --version; main.test.ts in-process: exit codes, one envelope on stdout even for help, argv index as the diagnostic path, the schema checker's own negative case; e2e/spawn-bin.ts fluxion(args) spawns the built bin, e2e/output-schema.ts outputErrors(value) checks the schema subset the CLI schema uses (its own negative case in the usage suite); the coverage harness sandbox drops src/e2e (those suites spawn dist/, absent there, and cover no source)
budget re-recorded after the review changes: staged 54.9 s (≤ 84 s), quick 7.5 s, cold 97.2 s; backlog M4.31 added (intermittent preservation property failure seen once in this row's staged run)
review F1-F4: the --json contract follows docs/standards/contracts.md instead of deviating: replies {apiVersion 1, command, ok, exitCode} with result (ok) or errors[] (not ok); a Zod schema per command reply in cli/src/output.ts (cli depends on zod, catalog, MIT), parsed before printing (an out-of-schema reply is an internal error with a conforming reply); packages/cli/schemas/{fluxion,validate,render}.output.json generated with z.toJSONSchema and compared by output.test.ts (file snapshots; biome skips the folder; the coverage sandbox copies it); help and version are results; flags after -- are positionals and --version works after a command; a throwing command keeps its name in the reply; ADR-0147, M4.md row 10, the M4.17 row and the gate leg name packages/cli/schemas/ (specs/ removed)

## 2026-09-29 M4.18 (claude)
cli: validate.ts (VALIDATE command, validateText over schema parseDocument): valid → exit 0 with result {diagnostics} (warnings), invalid → exit 1 with every diagnostic (JSON pointers into the document) as errors, unreadable file → FLX_CLI_IO exit 1, a missing or extra file argument → FLX_CLI_USAGE exit 2; a one-line summary on stderr; command.ts holds the shared types (CliIo, ExitCode, Outcome, Command) and outcome helpers (ok, usage, io, internal); main.ts keeps the table, dispatch and reply
M4.17 review F1: every exit-3 outcome carries FLX_CLI_INTERNAL (not-available command, exception, reply outside its schema); failure replies need at least one error (schemas regenerated); schema DIAGNOSTIC_CODES and docs/reference/diagnostics.md gain FLX_CLI_IO and FLX_CLI_INTERNAL; ADR-0147 amendment; an empty diagnostic path is left out of the stderr line
tests: e2e/cli.validate.test.ts spawning the bin: "FR-CLI-001: validate reports JSON-pointer diagnostics and exits 1" (both invalid fixtures, schema-valid reply, pointer paths, the named code, snapshot of each reply), valid and warning documents exit 0, missing file and argument errors
review F1-F2: the diagnostics reference states the command-line path rules (/argv/<index>, /argv for the whole line, empty for internal errors); a human-mode validate case checks the pointer reaches stderr and stdout stays empty

## 2026-09-29 M4.19 (claude)
render: golden.ts normalizeSvg(html) (exported): a small tag scanner over the static HTML; each screen's content layer becomes one <svg data-screen-id>: .fx-el wrappers as <g data-el-id data-kind data-place>, drawn SVG kept, .fx-label paragraphs as <text>; attributes sorted, numbers rounded to 1/100 outside names and hex colours, useId ids numbered in order (markers keep -start/-end); goldens packages/render/__golden__/{minimal,two-rects-line,unknown-kind}.svg (Vitest file snapshots, biome skips the folder, the coverage sandbox copies it)
tests: ssr.golden.test.ts "NFR-REL-005: SVG goldens match and a second render is byte-identical" (each valid fixture, two renders, file snapshot; ssr's stem so the coverage sandbox drops it with ssr.ts); golden.test.ts the normalizer's own case (groups, drawn SVG, labels, sorting, rounding, id numbering, two screens)
review F1-F2: tag names keep their source case (SVG is case-sensitive: linearGradient); placeholders (role, aria-label, text) and members containers (the offset undoing the parent's placement) are kept as <g> groups, so the unknown-kind golden checks the FR-DOC-005 placeholder and every golden the member offset

## 2026-09-29 M4.20 (claude)
cli: render.ts RENDER (fluxion render <file> -o <out.html> [--screen <id>…]): readInput (factored out of validate), parseDocument (invalid → exit 1 with its diagnostics, nothing written), unknown --screen id → FLX_CLI_USAGE exit 2, renderDocumentToHtml with the screen filter, write failure → FLX_CLI_IO exit 1, result {out, screens}, a one-line summary on stderr; the not-yet stub is gone; cli depends on @fluxion/render, react and react-dom (render's peers, catalog, MIT)
tests: e2e/cli.render.test.ts spawning the bin: "FR-CLI-001: render writes the two-rects-line HTML matching the golden" (schema-valid reply, no script, content CSS inlined, normalizeSvg(html) equal to packages/render/__golden__/two-rects-line.svg), --screen and unknown screen, invalid document, missing -o, unwritable output
budget re-recorded (lockfile): staged 53.5 s, quick 8.8 s, cold 97.6 s
review F1-F3: the --screen case writes a three-screen document (one hidden) and checks the page's screen ids with and without the filter; a requested hidden screen is a usage error (export skips it, which would write an empty page); the unwritable and missing -o cases assert their exit codes and codes

## 2026-09-29 M4.21 (claude)
e2e/render.static-html.spec.ts: "FR-SCR-001: the CLI output of two-rects-line renders as its baseline @visual" runs the built CLI (dist/bin.js) on two-rects-line, loads the HTML with setContent (no network), awaits document.fonts.ready and screenshots the .fx-screen (toHaveScreenshot, the config's maxDiffPixelRatio 0.001); baselines two-rects-line-{chromium,firefox,webkit}-linux.png taken in the pinned image mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c… with a copy of the tree (Linux install and build inside, host node_modules untouched)
the first baselines showed two render bugs, fixed here: the static page centred its screens in a flex column, so a screen wider than the window overflowed to the left out of reach (now a max-content column with margin auto); Chromium does not paint an empty SVG box with visible overflow, so connectors were missing in Chromium (the connector SVG now covers the route's box plus a 24 px margin, viewBox in screen coordinates; T1 asserts the box; the render goldens change by that attribute)
backlog: M4.32 added (one screenshot for the gradient parity case, which timed out once under load)

## 2026-09-29 M4.22 (claude)
examples/r0-static.flux.json (built with the schema testing builders, canonical): screen "Request path" (Browser → API → Database, a title box) and screen "Deployment" (load balancer → App A, App B; App A – App B without arrow), fills, strokes and font colours from theme tokens; validates with no diagnostics; examples/README.md
ci.yml build job: after the build, the built CLI renders the demo to r0-static.html and upload-artifact publishes it as r0-static-demo (14 days); actionlint and zizmor clean
tests: cli.render.test.ts "FR-CLI-001: examples/r0-static.flux.json validates with no errors and renders two screens of shapes, connectors and token styles"
review F1: the demo case checks the demo's own token styles per screen (primary, accent-1, stroke.thin; secondary, accent-3), not the background default every screen carries
the CLI e2e suites get a 30 s per-test timeout (E2E_TIMEOUT in spawn-bin.ts): the --screen case spawns the bin five times and exceeded the 5 s default under load in a staged run

## 2026-09-29 M4.33 (claude)
m4-complete CLI e2e leg: the spawn check reads each suite plus the helpers it imports from its own folder ('./x.js' → x.ts); checked against the real suites (spawning found through spawn-bin.ts) and against a suite alone (no spawn: red)

## 2026-09-29 M4.32 (claude)
shape-view.browser.test "FR-SHP-001: a gradient fill matches the background gradient of the same paint": the four views (linear and radial, as background and as shape fill) render stacked in one root and are captured in one screenshot, sampled per 100 px band; assertions unchanged; still fails against the pre-M4.30 bounding-box gradients

## 2026-09-29 M4.31 (claude)
the preservation property ("FR-DOC-005: any extra field at any depth…") failed once in the M4.17 staged ladder (stack through fc.assert: a property failure, not a timeout); its seed was not in the ladder's 40-line FAIL detail; no counterexample in 1.3 million cases (rerun: FC_SEED=<seed> FC_RUNS=100000 npx vitest run --project node packages/schema/src/preservation.test.ts -t "any extra field" --test-timeout=900000, with FC_SEED 7919, 15838, 23757 and ten runs without FC_SEED); the property is an inline constant with no shared file, and a forced timeout reports as a plain timeout
precommit.mjs: a failed step's detail keeps up to 6 fast-check lines (Property failed after, { seed: …, Counterexample:) found anywhere in its report, above the tail; ladder harness case
review F1-F2: the progress note no longer claims a kept ladder log (that was a local script, not repo machinery) and records the search command; testing.md §4 states that a failure's shrunk counterexample becomes a named case in the fixing commit and that the ladder keeps the seed lines

## 2026-09-29 M4.23 (claude)
docs: apps/docs guide "CLI quickstart" (validate, render, --screen, --json, exit codes; docs build 63 pages); READMEs of theme, render and cli describe the M4 status with a usage example (the theme example's output checked against dist); AGENTS.md of theme, render and cli gain an "Invariants (M4)" section; 04 §2.2 shows the R0 API as built (ScreenView, DocumentView, element views and registries, renderDocumentToHtml, normalizeSvg, the exported helpers) and lists the planned additions by milestone (camera view, breakpoint, cull, animState, handles, ElementView measure/a11y/exportSvg/cull/css, core ShapeDef)
changesets (minor): theme, render, cli, core, schema

## 2026-09-29 M4.34 (claude)
CI verify (windows-latest) has failed since 70cec10 (M4.20, cli → render): api.test's fullCopy runs tsc -b in a sandbox under os.tmpdir(), which on the runner is C:\Users\RUNNER~1\…; tsc printed long-name render sources relative to the short-name cwd and reported TS6142 (.tsx without --jsx) from the cli project, i.e. render's sources were not matched to the referenced render project; helpers.sandbox now creates sandboxes under realpathSync.native(tmpdir()) (the long form); not reproducible locally (no short names here), checked by the CI run after the push. macOS verify timed out once (core hooks property, 147 ms locally): watched, not changed

## 2026-09-29 M4.24 (claude)
docs/milestones/R0-exit.md: the five common exit criteria (01-scope §2) as seven checked items with evidence: check-trace --increment R0 ("every Must of R0 covered"), CI run 36501640817 at 343aa78 green on every job and OS (the M4.34 windows fix confirmed), the first visual baseline (M4.21), docs (CLI quickstart, API reference, READMEs, AGENTS.md, 04 §2.2), changesets, the demo rendered in CI, and the format note (no container in R0; schemaVersion 1.0 with migrations and round-trip tests; no record schema change since M2)
M4.23 review F1: the quickstart's sample shows the summary line and the hint in parentheses, as the CLI prints them

## 2026-09-29 M4.25 (claude)
final milestone review 5832cef..c70b53a (fresh milestone-reviewer): pass with four minor findings, all handed off to M5 (drive loop reads the last push's CI first; changeset leg from the range; renderDocumentToHtml returns rendered ids; test:visual without --pass-with-no-tests); CI evidence at c70b53a (gates 36502852777, ci 36502853068); roadmap Current milestone M5; M4 Learned +2 lines
m4-complete: GATE m4 27/27 legs green on this tree

## 2026-09-29 M5.1 (claude)
scripts/gates/m5-complete.mjs (red, 6/31 green): trace; the four M4 final hand-offs (last-push CI check, changesets from the range, strict test:visual, renderDocumentToHtml ids); ADR-0016; expression interpreter (diagnostics, 10 000 fuzzed templates, no eval/Function in any source); ShapeDef; packs/basic imports only the SDK + layering + definePack; 21 shapes; FR-SHP-005 per shape; shape style, text, image (T1); anchors; routers; markers, style, labels; FR-CON-012 property; gallery goldens (cli) and visual spec; the gallery example through the CLI and in ci.yml; READMEs; coverage (routing, geometry, core pure floors; render floors); verify; quarantines; CI evidence; backlog; final review; roadmap
milestone-checks titled() takes a package name or a workspace path (packs/basic); M4 backlog archived to docs/backlog/archive/M4.md; M5 backlog: 27 rows
review F1-F5 (plan): M5.3 also makes check-ci-evidence require the ci workflow's visual job; the goldens and example legs read the gallery document (all 21 basic defIds, the 4 route types, every FR-CON-003 marker); M5.13 split (fills and decorations) with M5.28 (strokes and effects), each with named T1 titles; the no-eval scan matches any eval reference, Function( and .constructor(; the studio's pack registration moves to M6 and rich-text label marks to M7 (roadmap Deferred, M6.md, M7.md); 28 rows
review r2 F1-F2: open-arrow and the crow's-foot variants are packs/basic markers named basic:* (the Marker type admits <ns>:<name>, so no format change), the schema's built-ins stay unqualified; the CI-evidence leg first requires the harness case 'evidence without a green visual job fails'

## 2026-09-29 M5.2 (claude)
scripts/harness/last-ci.mjs: for ci and gates, the newest completed run on main (gh run list --branch, else REST actions/runs?branch=, both through ci-runs.mjs's new branch() reader); a conclusion other than success/skipped exits 1 naming the workflow, sha and run; pending runs are reported but never hide an older red one; an unreadable GitHub prints a note and exits 0 (no verdict); drive (Orient step 3) and next-task (checklist) run it first; AGENTS.md command list
tests: harness last-ci.test.mjs "a red last run on main blocks the next task" (failure, red behind pending, cancelled), "a green or pending last run lets the task start" (green after an older red, only pending, none); a live run printed ci and gates green
review F1-F2: exit 2 when a red run has a newer pending run (wait for the fix's run, do not fix twice; a red workflow with nothing pending still exits 1), documented in drive, next-task and AGENTS.md; the branch readers take push events only (a PR from a fork's main is not main)
review r2 F1: only runs started after the newest completed one count as pending (an older running run cannot hold the fix); case with an older pending run exits 1

## 2026-09-29 M5.3 (claude)
milestone-checks: changesetGaps(changed, changesetTexts, workspaces) (published workspaces whose src/ or package.json the range touched and no changeset names) and changesetsCoverRange(base) over git diff base..HEAD and .changeset/*.md (M4's range 5832cef..HEAD passes); check-ci-evidence requires the ci workflow's visual job besides verify on three OSes (the stored c70b53a record passes: its visual job was green); test:visual without --pass-with-no-tests (playwright with a grep matching nothing: "Error: No tests found", exit 1); ci.yml's stale visual comment replaced
tests: harness "a package changed in the range without a changeset fails", "evidence without a green visual job fails (M5.3)" (failed and missing); the evidence fixtures' ci runs carry a visual job
ladder-scope: milestone-checks joins MANIFEST_HARNESS (its changesetGaps case names package.json paths; the manifest-reader pin)
review F1-F3: changesetsCoverRange counts only changesets the range added or modified (git diff --diff-filter=AM, read at HEAD: M4's unreleased changesets cover M4, not M5; git-sandbox case); changesetGaps reads only frontmatter release lines (a name in prose is no release); nightly visual-xos drops --pass-with-no-tests too
review r2 F1: both git diffs run with --no-renames (a file moved between workspaces changes both; the sandbox case fails without the flag)

## 2026-09-29 M5.4 (claude)
render: renderDocumentToHtml returns RenderedHtml { html, screens } (the ids it drew, page order; exported type); cli render counts result.screens from them instead of matching `<section class="fx-screen"` in the markup; render README and 04 §2.2 show the new shape; callers and tests read `.html`
tests: "FR-CLI-001: renderDocumentToHtml reports the ids of the screens it rendered" (visible screens in order equal to the page's data-screen-id list, a filter, a requested hidden screen draws nothing); render 40 node, SSR parity T1, cli 21 e2e pass

## 2026-09-29 M5.5 (claude)
ADR-0016 (accepted): outline = { path } SVG path data with {expr} numbers (M L H V C Q A Z) or { polygon: { n, x, y } } evaluated for i = 0…n-1; coordinates in the shape's own box; evaluateOutline in core normalizes to geometry cubics (arcs ≤ 90° per cubic); expression language: numbers, allow-listed identifiers (w, h, params, i, n, pi), arithmetic, comparison and ?:, min max abs sqrt sin cos tan atan2 floor ceil round clamp, a step budget (10 000), diagnostics never throws, no eval/Function; ShapeDef type + Zod schema in core; render's R0 outlines and basic:rect go (M5.9); params number/int/enum with ranges, clamped
03 §5 and ADR-0015 (amendment) point to it; indexed
review F1-F6: ADR-0016 states open outlines (a path without Z, points with closed false: no fill, hit-test by distance to the curve, projection onto it), a points outline and a points param type for polyline and freehand (element params already hold any JSON: no format change), one budget per evaluateOutline (100 000 steps) with caps (polygon n 2…1024, 1 024 template segments, 10 000 points), one subpath per outline, decorations as stroke-only path templates, and enum params evaluating to their index; 03 §5's ShapeDef sketch matches the ADR

## 2026-09-29 M5.6 (claude)
core/src/expr: hand-written tokenizer, recursive-descent parser (depth ≤ 64, source ≤ 2000 chars) to an AST keyed by `node`, tree-walking evaluator spending a shared step budget; identifiers resolved with Object.hasOwn (prototype names are unknown); FLX_EXPR_SYNTAX/UNKNOWN/DOMAIN/BUDGET diagnostics with a JSON pointer and the quoted source, never throws; fuzz 10 000 templates; tzap 100 % on the diff (tag checks before operator text marked equivalent)

## 2026-09-29 M5.7 (claude)
core/src/shape: ShapeDef type + Zod schema proven equal (checkedSchema, now exported by schema with anchorDefSchema, styleSchema, qualifiedNameSchema), parseShapeDef → FLX_SHAPE_DEF_INVALID; path templates (M L H V C Q A Z, {expr} numbers, command repetition, one subpath, nothing after Z) → FLX_SHAPE_PATH; evaluateOutline(def, size, params, budget) for path / polygon / points (straight or Catmull-Rom) outlines and decorations, one budget (100 000), caps → FLX_SHAPE_LIMIT; params clamped, own keys only; shapeDefs registry typed; geometry arcToCubics (unit-frame, robust to tiny and huge radii); M5.6 review minor: evaluateExpr checks hand-built num values, operators and node kinds; ADR-0016 amendment; tzap 100 % core and geometry

## 2026-09-29 M5.8 (claude)
ADR-0017: packs rank 5 in check-layering; hosts list the packs they bundle (cli: sdk, basic); sdk definePack/registerShapeDef (validate all first, register all or none, namespace <pack>:, FLX_PACK_INVALID) and re-exports of core's shape contracts, createCoreRegistries and evaluateOutline; packs/basic basicPack with basic:rect (imports only @fluxion/sdk); cli host.ts registers the bundled packs (render reports a failure as internal; M5.9 hands the registries to render); M5.7 review minors: int params need integer bounds, a raw __proto__ param key is refused (Zod's record drops it)

## 2026-09-29 M5.29 (claude)
M5.9's staged ladder failed every browser test ("Failed to fetch dynamically imported module", iframe not ready) whenever the harness suite ran: mutate.test.mjs runs tzap on packages/sdk, which M5.8/M5.9 give a diff, so tzap's Vitest ran in the checkout with the shared .vitest-cache and rewrote the optimized deps the ladder's browser run was serving; vitest.config.ts reads FLUXION_VITEST_CACHE and mutate.mjs points it next to the report; harness case

## 2026-09-29 M5.9 (claude)
render draws shapes from core ShapeDefs: RenderRegistries.shapeDefs is the host's core registry (createRenderRegistries/builtinRegistries take it), the shape view evaluates the outline for size and params (unknown or failing definition → placeholder); ShapeOutline and BASIC_RECT removed; render tests register their own rect (test-shapes.ts), goldens unchanged; the CLI passes its host registries (packs/basic draws basic:rect); M5.8 review minors: packs check every problem before registering (namespaces, repeated ids, keys another source holds) so a failed reload keeps the live entries; CLI internal-error test for a failing bundled pack; harness case that a package below the host layer may not bundle a pack; 04 §2 and ADR-0017 Confirmation updated

## 2026-09-29 M5.10 (claude)
packs/basic batch 1: rect, rounded-rect (r, clamped to half the shorter side), ellipse (two half arcs), triangle (apex), diamond, parallelogram (skew), trapezoid (inset), hexagon (inset), octagon (cut of the shorter side), star (points int 3..64, inner; polygon of 2*points), block-arrow (head, shaft); handles on every param; tests: closed and inside the box at four sizes and every param extreme, star 5→8 gives 16 vertices, params reshape outlines

## 2026-09-29 M5.11 (claude)
packs/basic batch 2: callout (tail, tip, width), cloud (eight outward arcs on an ellipse, template written from fixed fractions), cylinder (depth; front rim decoration), document (wave), note (fold; crease decoration), line (open, horizontal), polyline (points param), freehand (smooth points), text-box (transparent, no stroke), image-frame (mountain and sun decorations); all 21 register, close unless a stroke, and stay (with decorations) inside the box at four sizes and every param extreme; M5.10 review minor: block-arrow head and shaft capped at 0.95; review F1: smooth points outlines clamp their Catmull-Rom control points to the box (core), so strokes turning at an edge stay inside (ADR-0016 amendment)

## 2026-09-29 M5.12 (claude)
core shape/hit.ts: hitTestShape (closed: nonzero inside or within tolerance; open: within tolerance), outlineDistance, projectToOutline (outermost crossing of a ray, or the far end of an edge the ray runs along (review F1), snapped onto the outline; nearest point on a miss or a zero direction), re-exported by the SDK; per-shape tests in packs/basic (interior/exterior samples for all 21, 24 rays from inside and outside land on the outline within 1e-6); M5.11 review F1 follow-up: smooth.ts gives each vertex one fitted tangent (C1; out-of-box components at an edge dropped, the rest scaled to fit); ADR-0016 amendment

## 2026-09-29 M5.26 (claude)
cp1 milestone review (fresh milestone-reviewer, a0d31fd..e26cb9d): changes-requested. F1 major (shape view ignores defaultStyle and fills open outlines) → M5.30 before M5.24; F2 (parseShapeDef stops at strings) → M5.31; F3 (pack markers need an SDK contract change) → M5.20 amended; F4 (weak legs, no packs/basic floor) → M5.32; the gate names the new titles and the pending pack-marker title; M5.md Learned

## 2026-09-29 M5.30 (claude)
cp1 F1: theme resolveStyle takes a StyleKind, the kind optionally with its definition defaults, a layer under the element and its variant and over the theme defaults (02 §2 updated); the shape view passes ShapeDef.defaultStyle (diagnostics at /shapeDefs/<id>/defaultStyle) and fills an open outline with none; SSR test through the gate title

## 2026-09-29 M5.31 (claude)
cp1 F2: core shape/check.ts parses every template and expression of a definition and checks the names each may read (outline and decorations: w, h, pi, scalar params; polygon vertices add i, n; handles as the outline); parseShapeDef reports them with their own codes; M5.30 review minor: a definition default variant applies when the element has none

## 2026-09-29 M5.32 (claude)
cp1 F4: milestone-checks gains readmeGaps (no stub, 8+ lines, names what it must), propertyRuns (numRuns of the titled property) and coverageGaps (moved out of m5-complete); m5-complete docs leg names the 21 shape ids, the routes and anchors, and the SDK functions; the FR-CON-012 leg reads the property's runs (>= 1 000) from the routing test; packs/basic joins the coverage legs, and vitest.config gives packs the pure floors (testing.md §6 row); harness cases; M5.31 review minor: the Packs section of the diagnostics reference names the template and expression codes

## 2026-09-29 M5.13 (claude)
shape view (review F1-F4: styleKey keeps colour-only changes, views told to draw colours from resolved styles; styleKey memoized; views need the screen CSS variables; procedural pattern paint deferred to M9): image fills as SVG patterns (cover/contain/fill fit the box; tile repeats at the asset natural size: the pattern fill), drawn only from the host AssetUrls (new ScreenView/DocumentView/renderDocumentToHtml prop, via context; never an external source, NFR-PORT-002; the view follows its asset record); decorations drawn as unfilled strokes; ADR-0015 amendment: token refs are var(--fx-…) with no fallback, ScreenView keys the theme on theme styleKey and element lists are memoized, so a token value change restyles without re-rendering views (T1 render count); goldens re-recorded (fallbacks dropped only); carried minors noted on M5.14 and M5.23

## 2026-09-29 M5.33 (claude)
split from M5.14 (cp1 learned: split big rows): ADR-0018 shape text fitting; schema ShapeElement.textFit (mode none/shrink/grow, padding, minSize, overflow visible/clip; additive, the format is unreleased: 1.0 extended, no migration); ShapeDef text regions accept expression fractions (validated like outlines); core wrapText (words, TextMeasurer), fitText (shrink by bisection down to minSize), textRegion and fitShapeText (grow height = region height / region share, never below the current); packs/basic callout region follows its tail (M5.11 review F2); tzap 100 % on core

## 2026-09-29 M5.14 (claude)
render: createCanvasMeasurer (canvas measureText, width cache per font and line, ready() awaits document.fonts and clears the cache), a measurer prop on ScreenView/DocumentView/renderDocumentToHtml (context; default the page canvas measurer in a browser, none on a server); the shape label sits in the definition text region with textFit padding and overflow (clip → hidden), and shrink draws at fitShapeText size from the concrete font (var() values replaced from toCssVars); T1: grow height equals the DOM text within 1 px, shrink keeps bounds and font >= minimum; carried M5.33 review minors: grow share from the region fractions (flat boxes), words break at ASCII whitespace only (no-break spaces hold); review F1-F3: the page measurer re-measures when fonts finish loading (useFontGeneration), font style measured, text layout memoized and the width cache capped; the text-fit mode decision lives in core (shrinksText) so render never reads a mode field
