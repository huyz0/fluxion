---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.20; FR-LIB-007 within ADR-0048/0050, subject to independent review)
---

# ADR-0193 — A shared SDK suite builds, checks and draws declarative packs

## Context and Problem Statement

FR-LIB-007 requires twelve first-party packs whose definitions all pass visual snapshot
tests. ADR-0048 fixes the distribution as `index.json` plus SHA-256-pinned category files;
ADR-0050 requires credits covering every definition. Packs may import only `@fluxion/sdk`
(overview rule 4), so a pack's own tests cannot reach the renderer or core directly.
Writing category hashes by hand, or a separate checker per pack, would let the twelve
packs drift from the loader that hosts actually use.

## Decision Drivers

- One check for every pack: the same loader, license policy and renderer hosts use.
- Packs keep importing only the SDK; no private path into render or core.
- Deterministic distribution bytes, so a reviewed file diff is the whole change.
- Test helpers and the renderer stay out of the SDK's runtime entry.

## Considered Options

1. **A helper under `scripts/` imported by relative path.** Passes the import gate but is a
   back door around rule 4 and is unavailable to third-party pack authors. Rejected.
2. **Hand-written JSON checked only by schema tests.** No renderer coverage, and hashes are
   maintained by hand. Rejected.
3. **A `@fluxion/sdk/testing` entry.** Chosen. It follows `@fluxion/schema/testing`.

## Decision Outcome

Add the subpath export `@fluxion/sdk/testing`, built as its own module:

- `buildShapePackFiles(draft)` writes canonical two-space JSON with a final newline:
  `index.json` and one `categories/<slug>.json` per category in order of first use,
  each category's SHA-256 recorded in the index. It validates nothing.
- `checkShapePackFiles(files, licensePolicy?)` loads the files through
  `createShapePackLoader` with the repository content policy by default, rejects files
  the index does not name and an empty pack, and returns every definition in index order.
- `renderShapeGolden(def)` registers one definition through the SDK, draws it alone at its
  default size and style with the static renderer, and returns `normalizeSvg` text
  (NFR-REL-005). An unregistrable definition or one without outline path data throws.

The SDK gains `@fluxion/render` as a dependency (already allowed by the package map) and
optional React peers, used only by the testing entry. A first-party pack keeps its
distribution in `pack/` and goldens in `__golden__/`. Its `src/pack.test.ts` requires
`pack/` to equal the canonical build of its exported definitions, loads every definition
from the checked-in files, and compares each definition's golden.

### Consequences

Good: every pack runs the same checks with no new dependency or gate script; `vitest -u`
regenerates files and goldens, so a reviewed diff shows each change. Bad: goldens are
normalized SVG text, not pixels, so browser rasterization differences remain the render
package's browser tests' concern. The SDK API report gains a `testing` entry.

### Confirmation

`packages/sdk/src/testing/testing.test.ts` proves deterministic builds, loading in index
order, and rejection of an edited category, a stray file, a missing index, a forbidden
license, an empty pack and an undrawable definition. `packs/basic/src/pack.test.ts` runs
the suite over all basic definitions; `m18-complete` runs every pack's `pack.test.ts`.

## More Information

ADR-0011 (subpath entries), ADR-0017 (SDK registration), ADR-0048, ADR-0050, ADR-0181
(lazy loader); `packages/render/src/golden.ts`.
