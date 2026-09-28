---
name: tdd
description: Implement a task test-first. Use whenever writing or changing code. Covers the red-green-refactor cycle, choosing the test tier, naming tests with requirement IDs, and the rules that keep generated tests meaningful.
---

# Test-driven implementation

Standards: `docs/standards/testing.md`, `docs/standards/coding-typescript.md`,
`docs/standards/code-structure.md`. Read the package's `AGENTS.md` first.

## Cycle

1. Write the failing test for one acceptance criterion. Name it with the requirement ID:
   `it('FR-CON-004: orthogonal route avoids obstacles', …)`.
2. **Run it and watch it fail** for the expected reason. A test never seen failing proves nothing.
3. Implement the smallest change that passes.
4. Run it and watch it pass. Run the package's whole suite.
5. Refactor with tests green. Repeat for the next criterion.

## Pick the lowest tier that can observe the behaviour

| Tier | Use for | Tool |
|---|---|---|
| T0 | pure logic: schema, geometry, core, layout, routing, anim, dsl, format | Vitest (node) + fast-check |
| T1 | React components, render output, editor widgets | Vitest browser mode / Storybook play |
| T2 | user flows across studio/player | Playwright |
| T3 | pixels & SVG output | Playwright screenshots in pinned image, normalized SVG goldens |
| T4 | performance budgets | vitest bench / Playwright traces vs `thresholds.mjs` |
| T5 | AI generation quality | `pnpm eval` |

If a T0 test seems to need DOM, time or randomness, the logic is in the wrong layer — inject a
port (`Clock`, `Random`, `TextMeasurer`, `FileIO`) instead of climbing tiers.

## What to assert

- Behaviour and contracts, not implementation details.
- Invariants as properties for geometry/layout/undo (fast-check, seeded, `numRuns` from thresholds).
- Golden files for serialized output (`.flux.json`, SVG) — update only with a
  `Threshold-change:` trailer explaining why.

## Never

`sleep`/real timers (use `VirtualClock`/fake timers) · unseeded randomness · network ·
`.only`/`.skip` committed · deleting or loosening a test to make it pass · snapshot updates
without reading the diff.

## Done means

- Every acceptance criterion observed passing (paste the test output lines).
- Package suite + `node scripts/gates/precommit.mjs --staged` green.
- Optional for pure packages: scoped mutation run (`pnpm mutate --package packages/<name> --from HEAD`,
  tzap) — a surviving mutant means a line executed but unconstrained.
