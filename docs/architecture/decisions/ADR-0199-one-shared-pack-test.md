---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.129; cp13 F7, subject to independent review)
---

# ADR-0199 — Every first-party pack runs one shared pack test

Extends ADR-0193 and ADR-0194: the checks and the write run are unchanged; where they are registered moves into the SDK.

## Context and Problem Statement

ADR-0194 made each first-party pack's `src/pack.test.ts` a short file, but every one still
carried its own write-run guard (`VITE_FLUXION_WRITE_PACK` plus `vitest run -u`), its own file
snapshots and its own comparison. Twelve copies drift: cp13 F7 found two variants already, and
a pack that dropped the `-u` guard would let a leaked variable rewrite its goldens in a gate.

## Decision Drivers

- FR-LIB-007: every pack's definitions pass the same visual and file checks.
- One place to fix the write guard (M18.100, M18.110) for every pack.
- Packs import only `@fluxion/sdk` (overview rule 4); `import.meta.glob` must stay in the pack's
  own file, because Vite resolves its literal patterns relative to that file.

## Considered Options

1. **A shared file under `scripts/` imported by relative path.** Breaks rule 4 and is unavailable to
   third-party pack authors. Rejected.
2. **Keep per-pack files and lint them for the guard.** The copies still differ in everything the
   lint does not pin. Rejected.
3. **`testShapePack(source, globs)` in `@fluxion/sdk/testing`.** Chosen. The pack passes its exported
   source and the raw glob results; the SDK registers the one test, reads the write variable and
   writes or compares.

## Decision Outcome

`@fluxion/sdk/testing` exports `testShapePack(source, globs)` and its `ShapePackGlobs` type. Called
inside the pack's `describe` (whose title names the requirements, for the trace gate), it registers
"the checked-in files are the build of the exported source, with no problem": ordinary runs assert
`checkShapePack` reports nothing; a run with `VITE_FLUXION_WRITE_PACK=1` must also be `vitest run -u`
and then rewrites `pack/`, `__golden__/` and `pack-versions.json` (`toMatchFileSnapshot` resolves
relative to the calling test file). The write variable is read from the process's environment (live, so
`vi.stubEnv` reaches it), else, in a browser, from Vite's. The SDK gains `vitest` as an optional peer dependency (MIT),
used only by the testing entry, which already runs only under Vitest. Its optional
`peerDependenciesMeta` entry makes dependency-cruiser also type the import `npm-no-pkg`, so the
undeclared-dependency rule exempts a declared peer (it still fires on an undeclared import).

### Consequences

Good: a pack suite is its globs and one call; fixing the guard fixes every pack. Bad: the testing
entry now imports `vitest`, so it can only be loaded inside a Vitest run; the SDK API report grows
by one function and one type.

### Confirmation

`tests/harness/pack-tests.test.mjs` fails any declarative pack whose `src/pack.test.ts` does not
import and call `testShapePack`, or compares, snapshots, registers a test or reads the write
variable itself; `tests/harness/pack-goldens.test.mjs` still proves a deleted or orphan golden fails
and the variable without `-u` fails without writing.
