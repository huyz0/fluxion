---
status: accepted
date: 2026-09-28
decision-makers: harness (M2 final review F3, row M3.3; within NFR-MNT-007 and coding-typescript rules 10–12)
---

# ADR-0144 — One Result shape across pure packages; each package owns its error-code union

## Context and Problem Statement

coding-typescript rule 10 says expected failures return `Result<T, FluxError>`, and rule 12 lists
every error code in `schema/src/errors.ts`. M2 shipped two conventions: `@fluxion/schema` exports
`Result<T, E = FluxError>`, `ok(value)` and `err(error)`, while `@fluxion/geometry` had its own
`Result<T>` fixed to `GeometryError` and an internal `err(code, message)`. Geometry cannot import
schema (both are layer L0 with no dependencies), so its codes cannot live in schema's file. The M2
final review (F3) asked for one convention before `@fluxion/core`, which imports both, is built.

## Decision Drivers

- NFR-MNT-007: public API stays coherent; the change is free before the first release.
- Layering (non-negotiable 5): L0 packages do not import each other.
- Rule 10's intent: callers handle every expected failure with one `if (!r.ok)` pattern.

## Considered Options

1. **One structural shape, repeated in each L0 package that needs it; per-package code unions.**
   `Result<T, E>`, `Ok<T>`, `Err<E>`, `ok(value)`, `err(error)` have the same definition and
   signatures everywhere; each package's `errors.ts` holds its code union (schema: `FluxErrorCode`,
   geometry: `GeometryErrorCode`, core: its own).
2. A new L0 module that both schema and geometry import (e.g. `@fluxion/result`).
3. Keep both conventions and alias at import sites in core.

## Decision Outcome

Chosen option 1. Geometry's `Result` becomes `Result<T, E = GeometryError>` with `Ok`/`Err` and an
`err(error)` taking one error object, identical in shape to schema's, so a geometry `Result<T>`
is a schema `Result<T, GeometryError>`. `GeometryError` and its codes move to
`geometry/src/errors.ts`. Rule 12 is amended: every package that reports expected failures lists
its codes in its own `src/errors.ts`; codes stay public API (add, never rename).

### Consequences

- Good: core and later packages handle schema and geometry failures with one type and one pattern.
- Good: no new package and no L0 cross-import.
- Bad: the five-line shape is repeated in each L0 package that needs it; the type test below keeps
  the copies equal.

### Confirmation

`packages/core/src/result-convention.test.ts`: `NFR-MNT-007: geometry Result is assignable to the
schema Result` (compile-time `toEqualTypeOf` plus runtime values) and `NFR-MNT-007: a schema err
value is a geometry Result`. The M3 completion gate runs the first by title.

## Pros and Cons of the Options

### Repeated structural shape

- Good: zero dependencies, layering intact. Bad: duplication, guarded by a test.

### Shared L0 module

- Good: one definition. Bad: a new published package and a dependency edge for a five-line type.

### Aliasing in core

- Good: no change to M2 code. Bad: two `err` signatures remain; every consumer repeats the aliasing.

## More Information

M2 final review F3 (`.harness/reviews/milestone-M2-final.json`); coding-typescript rules 10–12.
