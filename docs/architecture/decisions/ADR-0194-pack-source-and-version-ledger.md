---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.102; cp10 F4, F8; amends ADR-0193, subject to independent review)
---

# ADR-0194 — Packs export their source; one SDK check covers files, versions and bounds

## Context and Problem Statement

Under ADR-0193 each first-party pack test held its own display names, pack version and
credits, and repeated the brand, bounds and file-match code. Checkpoint 10 found that the
metadata a library or AI catalog needs was invisible outside the test (F4), that the index
said `1.0.0` while the package said `0.0.0`, and that changed geometry could ship under an
unchanged pack version (F8).

## Decision Drivers

- One source of pack metadata, readable by library and AI catalogs (M18.32, M18.41).
- One shared check, so eleven packs cannot drift apart.
- A changed category hash must force a new pack version, without manual bookkeeping.

## Considered Options

1. **Keep metadata in tests, add a version test per pack.** Duplicated eleven times;
   catalogs still cannot read names. Rejected.
2. **Read metadata back from `pack/index.json` at runtime.** Makes the generated file the
   source. Rejected.
3. **Exported `DeclarativeShapePack` source plus an SDK suite check.** Chosen.

## Decision Outcome

- `@fluxion/sdk` exports `DeclarativeShapePack`, `namedShapeDefs(defs, names)` and `buildShapePackFiles(pack)`, the builder moved from
  the testing entry. Each pack exports `<pack>Source` with `version: VERSION` (its package
  version), names, credits and named definitions. Its `Pack` registers the same definitions.
- `@fluxion/sdk/testing` adds `shapePackExpectation(pack, ledger)` and
  `checkShapePack(pack, checkedIn)`. They return every problem by check: files (pack/,
  goldens and ledger missing, extra or changed), loading, brands, bounds and versions. Bounds
  covers the drawn golden (segment ends and `Q`/`C` midpoints; unknown path commands fail) and,
  at each number param's minimum, maximum and default and every enum value, the evaluated
  outline, decorations and handles staying in the box and text regions being nonnegative and
  inside it; anchors must be box fractions and number params must have a range (M18.103).
  Bounded number params are also checked together at every corner of their range (every pair's
  corners beyond six params), and every variant at the default size and at the smallest sizes
  the check resizes to: a 16 x 16 square and the default narrowed or flattened to 16 units
  (M18.121, cp12 F5).
- `pack-versions.json`, shipped with the pack, maps each released version to its category
  hashes. The current version is added when absent and never replaced, so changed hashes at
  a recorded version fail with "release the change as a new pack version". The package
  version must equal the source version. A malformed ledger is reported and never rebuilt.
- Pre-release and releases (M18.110, cp11 F5/F7): `0.0.0` (`UNRELEASED_PACK_VERSION`) is never
  recorded, so geometry changes freely before the first release. Every `## <version>` heading of the
  package's `CHANGELOG.md` is a released version whose ledger entry must stay. `pnpm run
  version-packages` (`changeset version` then `scripts/packs/sync-versions.mjs`, the release
  workflow's version step) copies each bumped package version into the pack's `VERSION` and rebuilds
  `pack/`, goldens and ledger.
- A write run needs `VITE_FLUXION_WRITE_PACK=1` and `vitest -u` together; the variable alone fails
  without writing, so a leaked variable cannot make a gate write or pass a missing golden.
- A pack test reads `pack/`, `__golden__/`, `package.json`, the ledger and `CHANGELOG.md` and requires every
  problem list to be empty. Only `VITE_FLUXION_WRITE_PACK=1 vitest -u` writes (M18.100).

### Consequences

Good: catalogs import names and credits; a geometry change without a version bump fails;
pack tests are a few lines. Bad: `@fluxion/sdk` main API grows by one type and two pure
functions; packs must bump their package version (changeset) to change shipped geometry.

### Confirmation

`packages/sdk/src/testing/testing.test.ts` proves clean builds have no problems, and that
missing, changed and orphan files, a version mismatch, changed hashes at a recorded
version, a brand, a blank name, an empty pack, drawing outside the box, curve midpoints
and unreadable path data are each reported. Every `packs/*/src/pack.test.ts` runs the check.

## More Information

ADR-0048, ADR-0050, ADR-0193 (superseded where it puts the builder in the testing entry and
pack metadata in tests). ADR-0196 (M18.108) moves the encoding into core's shared
`encodeShapePack`: `buildShapePackFiles` now validates and returns a `Result`.
