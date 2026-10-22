# @fluxion/schema — agent notes

Zod 4 schemas and TS types for every record; IDs; validation errors; JSON Schema generation; migrations.

## Rules

- Layer L0: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Version 1.1 (M8)

- `section` records (`records/section.ts`); `screen.sectionId` must name one. The migration `migrations/1.0-to-1.1.ts` drops the dangling `sectionId` a 1.0 screen could carry. Released fixtures are frozen: `__fixtures__/v1.0/` (input), `v1.1/`, and `migration/` for extra inputs.
- `SCREEN_PRESETS` and `presetOf` (16:9, 4:3, 16:10, 9:16, A4).

## Version 1.2 (M9)

- `document.description`, `tags`, `custom` and `screen.themeId` (a `theme` record; `FLX_REF_MISSING`, `FLX_REF_WRONG_TYPE`). The migration `migrations/1.1-to-1.2.ts` normalises what a loose 1.1 file may already carry there (ADR-0152). Released fixtures stay frozen: `__fixtures__/v1.0/`, `v1.1/`, `v1.2/` (inputs that migrate), `v1.3/` (current), and `migration/` (`dangling-section-1.0`, `nonconforming-1.1`, `nonconforming-1.2`). A new field or reference check bumps the version, appends a step and adds a fixture of the version it leaves.

## Version 1.3 (M12)

- `LayoutSpec` on `screen`, `group` and `frame` (`records/layout-spec.ts`) and `document.source` (FluxScript salt and deferred sections), ADR-0031. `migrations/1.2-to-1.3.ts` drops non-conforming values there.

## Version 1.6 (M17)

- A `LayoutSpec` gains an optional `live: boolean` (re-lay the container out after edits; stored only) (ADR-0046, FR-LAY-010). `migrations/1.5-to-1.6.ts` drops a non-boolean `live` from a screen's, group's or frame's `layout`. Fixtures: `v1.6/` (current), `migration/nonconforming-1.5`.

## Version 1.5 (M16)

- A connector `route` gains `tangents` (offsets by route-point index; the `curved` router's control points) and `jumps` (`arc` | `gap` | `none`) (ADR-0168). `migrations/1.4-to-1.5.ts` drops a `tangents`/`jumps` the typed fields refuse. Fixtures: `v1.5/`, `migration/nonconforming-1.4`.

## Version 1.4 (M16)

- `AnchorDef` gains `kind` (`fixed` | `side` | `perimeter` | `center`), `side` and `t`; `x`/`y` are required for `fixed` only (ADR-0043). `migrations/1.3-to-1.4.ts` drops a `kind`/`side`/`t` the typed fields refuse. Fixtures: `v1.4/`, `migration/nonconforming-1.3`.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 (node) only — no DOM in tests.
