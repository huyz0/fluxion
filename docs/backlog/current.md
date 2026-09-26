# Backlog — M0 Harness bootstrap & verification

Planned: 18 rows · Completion: `node scripts/gates/m0-complete.mjs` · Plan: [M0](../milestones/M0.md)

Only the current milestone lives here. Closed milestones move to `archive/M<n>.md`.
States: `todo` · `doing` · `done` · `blocked (<reason>)`. Commit: `git log --grep "^<ID>:"`.

| ID | Task | Req | Acceptance (EARS) | Deps | State | Commit |
|---|---|---|---|---|---|---|
| M0.1 | Install Node ≥ 22 + pnpm (repo already `git init`-ed, hooksPath set); `node scripts/harness/setup.mjs`; fix any defect in existing harness scripts until `precommit.mjs --all` is green | NFR-DX-003 | WHEN `node scripts/gates/precommit.mjs --all` runs THE SYSTEM SHALL print PASS or SKIP(with reason) per step and exit 0 | — | todo | |
| M0.2 | Run `m0-complete.mjs`; confirm red; record failing legs in progress log | HARNESS | WHEN the gate runs THE SYSTEM SHALL print one PASS/FAIL line per leg and exit 1 | M0.1 | todo | |
| M0.3 | `tests/harness/commit-msg.test.mjs` negative + positive cases | NFR-DX-003 | WHEN a subject lacks a backlog task ID, has a wrong type, or an empty trailer THE SYSTEM SHALL exit 1; valid subject → 0 | M0.1 | todo | |
| M0.4 | `tests/harness/portability.test.mjs` on temp fixture trees | NFR-DX-003 | WHEN a skill has vendor syntax, name≠dir, built-in name, >150 lines, or a stale adapter THE SYSTEM SHALL exit 1 | M0.1 | todo | |
| M0.5 | `tests/harness/review.test.mjs` in a temp git repo: record/hash/check-reviewed | NFR-DX-003 | IF the staged diff changes after a verdict is recorded THEN check-reviewed SHALL exit 1; matching pass verdict → 0 | M0.1 | todo | |
| M0.6 | `scripts/gates/check-size.mjs` (harness doc caps now; code caps activate when packages exist) + tests | NFR-MNT-003 | WHEN AGENTS.md > 250 lines or a progress entry > 10 lines THE SYSTEM SHALL exit 1 | M0.3 | todo | |
| M0.7 | `scripts/gates/check-tests-kept.mjs` + tests | NFR-DX-004 | IF a staged change deletes a test file or `it(`/`test(` case without a `Removes-test:` trailer in the pending message THEN THE SYSTEM SHALL exit 1 | M0.3 | todo | |
| M0.8 | `scripts/gates/check-drift.mjs` + tests | NFR-DX-004 | IF a threshold moves in its `weakens` direction vs HEAD without `Threshold-change:` + ADR ref THEN THE SYSTEM SHALL exit 1 | M0.3 | todo | |
| M0.9 | `scripts/harness/build-index.mjs [--check]` for AGENTS.md skills table & standards index | NFR-DX-003 | WHEN a skill description changes and the table is stale THE SYSTEM SHALL exit 1 under --check | M0.4 | todo | |
| M0.10 | `scripts/harness/stop-check.mjs` Stop hook + tests + doc | NFR-DX-003 | WHILE state.loopActive and the gate is red THE SYSTEM SHALL output a block decision naming the first red leg; otherwise allow | M0.2 | todo | |
| M0.11 | `.codex/` adapter config (hooks: PostToolUse quick gate; optional Stop) verified against current Codex docs | NFR-DX-003 | WHEN a Codex session starts in the repo THE SYSTEM SHALL list all 13 skills; edit triggers quick gate | M0.9 | todo | |
| M0.12 | `.github/workflows/gates.yml` (ubuntu/windows/macos, SHA-pinned, runs precommit --all + tests/harness) | NFR-PORT-005 | WHEN pushed THE SYSTEM SHALL run gates on 3 OSes (verified by actionlint locally until first push) | M0.8 | todo | |
| M0.13 | `run-reviewer.mjs` cross-vendor smoke on a seeded defect (both directions) | NFR-DX-003 | WHEN a diff with a seeded off-by-one is reviewed THE SYSTEM SHALL record a verdict with ≥1 major/blocking finding in ≥1 direction | M0.5 | todo | |
| M0.14 | Claude `/goal` dry run: toy milestone success + impossible case → `docs/harness/dry-runs.md` | NFR-DX-003 | WHEN the toy gate passes the goal SHALL end; WHEN impossible it SHALL stop with blockedReason | M0.10 | todo | |
| M0.15 | Codex `/goal` dry run, same two cases → `docs/harness/dry-runs.md` | NFR-DX-003 | Same as M0.14 for Codex | M0.11 | todo | |
| M0.16 | `scripts/harness/worktree.mjs create/remove <slug>` | NFR-DX-003 | WHEN run THE SYSTEM SHALL create `../fluxion-<slug>` on branch `agent/<slug>` | M0.1 | todo | |
| M0.17 | `docs/harness/README.md` operator guide (start/monitor/stop loops, troubleshooting) | NFR-DX-003 | Guide linked from AGENTS.md; check-portability passes | M0.14 | todo | |
| M0.18 | Milestone review M0 (fresh agent) + dispositions + roadmap current → M1 | all | `.harness/reviews/milestone-M0-final.json` exists; m0-complete exits 0 | all | todo | |
