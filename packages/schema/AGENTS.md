# @fluxion/schema — agent notes

Zod 4 schemas and TS types for every record; IDs; validation errors; JSON Schema generation; migrations.

## Rules

- Layer L0: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Version 1.1 (M8)

- `section` records (`records/section.ts`); `screen.sectionId` must name one. The migration `migrations/1.0-to-1.1.ts` drops the dangling `sectionId` a 1.0 screen could carry. Released fixtures are frozen: `__fixtures__/v1.0/` (input), `v1.1/`, and `migration/` for extra inputs.
- `SCREEN_PRESETS` and `presetOf` (16:9, 4:3, 16:10, 9:16, A4).

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 (node) only — no DOM in tests.
