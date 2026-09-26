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
