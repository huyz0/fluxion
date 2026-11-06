---
status: accepted
date: 2026-11-05
decision-makers: the coordinator under Huy's delegation of 2026-11-04 13:34:57Z ("you decide and carry on"), 2026-11-05 07:12Z; kept under Huy's full delegation of 2026-11-05 11:04:52Z ("you decide for me and unblock anything"), which decides cp25 F4 and cp46 F1
---

# ADR-0216 — The cold setup measures the ladder without coverage; the verify jobs gate coverage

## Context and Problem Statement

NFR-DX-001 asks a fresh clone to install, set up and pass `pnpm verify` in under 10 minutes on the
reference machine; ci.yml's cold-setup job measures it (check-budget --cold, COLD_SETUP_MAX_MS
600 s). Since M18.117 it has run over: 807.5 s at 7989d10, with Vitest with coverage the critical
leg (746 s) and harness-tests 555 s, attw 397 s and api 318 s beside it on a 4-core runner. Two
attempts at M18.157 that changed only scheduling gained nothing (M18.160 and the second, lower
priority for the other legs).

M18.157's diagnostic review (ADR-0176) measured on 4 cores at 980429d: the ladder is CPU-bound
(1297 CPU-s in 415 s); Vitest with coverage takes 292 s alone, 217 s without; the browser project
runs its 126 files one at a time after the node project (143 s), and three at a time takes 71 s
with every test passing. Moving coverage off the cold setup alone projects to 615–675 s in CI,
because harness-tests then becomes the critical leg; with the harness cuts and the browser files
three wide it projects to 545–565 s.

Where coverage is gated is cp25 F4, which was on Huy's card. The coordinator decided it under
the standing delegation, and Huy's full delegation of 2026-11-05 11:04:52Z keeps that decision: coverage leaves the cold-setup path and keeps gating main, floors
unchanged.

## Decision Drivers

NFR-DX-001 (the cold setup), NFR-MNT-004 (coverage floors), the rule that no gate is loosened to
pass it (COLD_SETUP_MAX_MS and every floor unchanged), and ci-cd.md §5.

## Considered Options

1. **The cold setup runs the ladder with `--no-coverage`; the three verify jobs keep `pnpm verify`
   with coverage.** No new job; coverage keeps gating on ubuntu, Windows and macOS. Chosen.
2. **A separate coverage job, and `pnpm verify` without coverage everywhere.** Keeps NFR-DX-001's
   literal command, but the Windows and macOS verify jobs would stop judging the floors, local
   `pnpm verify` would no longer be the whole gate, and CI would run Vitest once more. Rejected.
3. **Leave coverage in the cold setup and cut only elsewhere.** The review's cuts reach about
   100–130 s of the 200 s needed. Rejected.
4. **`isolate: false` for the node project** (−55 s alone, four files fail). Needs its own ADR and
   a test-independence review; not this attempt.

## Decision Outcome

Option 1, with the review's cuts:

- `precommit.mjs --all --no-coverage` runs the test step as `vitest run` (both projects, no
  coverage) and says so in its log. The flag is refused outside `--all` (exit 2), so a staged or
  quick run never drops coverage. check-budget's cold setup (`--cold` and `--record`) is its only
  caller: it runs `pnpm verify --no-coverage`. ci-workflow.test pins that no workflow, hook, script
  or package script passes it, and that `verify` and `test:coverage` are unchanged.
- The verify jobs (ubuntu, Windows, macOS) run `pnpm verify`, coverage and floors as before, and
  ci-ok needs them. The staged pre-commit keeps its coverage run.
- On Linux and macOS the browser project runs after the node project (`sequence.groupOrder`),
  three files at a time on Linux; macOS stays one at a time (M18.44). On Windows both projects
  run one file at a time, and Vitest runs the one-worker node project last, after the browser one,
  as before (M18.276 corrects this ADR's first wording, which said every OS).
- Harness cases that repeated a ladder leg on the real repo share or drop that work: the licences
  gate's real-repo runs (the ladder's licenses step runs the same gate on the repo) give way to a
  fixture that keeps the pack-index count, workspace-shape's two type-check cases share one
  sandbox and one full `tsc -b`, and layering's real-tree and lower-import cases share one run.

### Consequences

- This is a change to NFR-DX-001's wording, made through the spec route (30-non-functional.md,
  specs/M18.157-cold-setup-coverage), not a loosened threshold: the cold setup now measures less
  work, Vitest without coverage, against the same 600 s limit. COLD_SETUP_MAX_MS and every
  coverage floor are unchanged.
- Good: coverage still gates main on three OSes; `pnpm verify` stays the full gate.
- Bad: a fresh clone's first `pnpm verify` with coverage can take longer than the measured cold
  setup; the measurement no longer says how long.
- Bad: on Linux, browser files share the machine with each other and with harness, attw and api,
  though never with the node project's bounded-time tests. The first CI runs are the evidence.
- macOS and Windows keep their order and width. A project of one worker with groupOrder 0 goes to
  Vitest 5's sequential group, which runs after the ordered ones (groupSpecs): on macOS that was
  and is the browser project, after the node one, so the explicit groupOrder adds no time to macOS
  verify's 20 minutes (ADR-0209); on Windows it is the node project, which runs last, after the
  browser one, as before this change.
- M18.157 closes only after three consecutive main runs within the limit; budget.json's cold
  number is then recorded with `--cold-from-ci` (ADR-0145), which ends M18.159's exemption.
- cp25 F4 and cp46 F1 are decided under Huy's 2026-11-05 11:04:52Z delegation; NFR-DX-001's wording is
  no longer provisional.
- Closed (M18.157): attempt 3 alone left the slow runner class at 612–621 s. Attempt 4 (c8d8792), after a fresh diagnostic
  review, packs each library once for publint and attw and builds one API Extractor program over every entry, every check
  kept. Main then read 512 s, 581 s (the slow class) and 434 s; budget.json records 442 s from ci 42306748397 (f91d02d).
  Stream 1 ruled, under Huy's delegation, that harness tests stay in the cold ladder; a slow-class overrun now goes to a
  fixed reference runner (docs/standards/ci-cd.md §4).
