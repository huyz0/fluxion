---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.133; the recommended option of the question put to Huy on 2026-10-27, subject to independent review)
---

# ADR-0202 — visual-xos gates the pinned ubuntu leg; Windows and macOS are known red until M32

## Context and Problem Statement

The nightly `visual-xos` job runs the `@visual` specs on Chromium on ubuntu, Windows and macOS
(NFR-PORT-006). It has been red since M11 for reasons no fix row can remove before M32:

- The baselines are the pixels of the pinned Playwright image (`ci.yml`'s `visual` job). A bare
  ubuntu runner draws text about 1.0 % differently (M11.66), so the ubuntu leg failed on fonts,
  not on a regression.
- macOS has no `-darwin` baselines and Windows has no `-win32` ones; making them and setting a
  cross-OS tolerance is roadmap M32 item 11, the milestone that owns NFR-PORT-006.

A nightly that is red every night hides a new failure (M18.124 F2): the report job opens the same
issue whatever broke, and last-ci prints the nightly as red.

## Decision Drivers

- A red nightly must mean something new broke.
- No visual threshold and no baseline changes (non-negotiable 2); no per-OS baselines invented
  before M32 decides the tolerance.
- The cross-OS legs keep running, so their diffs stay visible and M32 starts from evidence.

## Considered Options

1. **Pinned ubuntu leg gates, Windows and macOS known red (chosen).** The ubuntu leg runs in the
   pinned image, so it compares like with like and must be green. The two other legs carry
   `known-red: true`, which sets job-level `continue-on-error`: they run, annotate and upload
   their diffs, but their failure does not fail the run or open the nightly issue.
2. **Make per-OS baselines now.** Pulls M32 item 11 forward without its tolerance decision, and
   needs Windows and macOS runs to generate pixels no reviewer can check here.
3. **Drop the job until M32.** Green, but loses the cross-OS evidence and the pinned-image
   nightly check on main.

## Decision Outcome

Option 1. `nightly.yml`'s `visual-xos` matrix lists each leg with its `image` (the ubuntu leg
uses the digest-pinned image of `ci.yml`'s `visual` job; the others run on the bare runner and
install Chromium) and its `known-red` flag; the job sets `container: ${{ matrix.image }}` and
`continue-on-error: ${{ matrix.known-red }}`. `tests/harness/ci-workflow.test.mjs` pins the
legs, the shared image, and that `continue-on-error` appears nowhere else but the bounded
clipboard probe.

### Consequences

- Good: the nightly's visual verdict is the pinned ubuntu leg; a red nightly is news again.
- Good: Windows and macOS still produce annotations and `visual-xos-<os>-results` diffs.
- Bad: a regression that shows only on Windows or macOS no longer reds the nightly; it is
  visible in the run's failed leg only. Accepted until M32 item 11.
- M32 item 11 removes the `known-red` flags when the per-OS baselines and tolerance land; the
  roadmap's deferral row names this ADR.

## More Information

- Roadmap deferral: `docs/milestones/roadmap.md`, "The visual-xos nightly" (M11 → M32 item 11).
- M11.66, M11.67 (why each leg failed); M18.124 F2 (the split to M18.133).
