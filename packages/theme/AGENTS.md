# @fluxion/theme — agent notes

Token model (DTCG), token resolution, palette generation (OKLCH), contrast checks, CSS-variable emission.

## Rules

- Layer L1: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 (node) only — no DOM in tests.

## Invariants (M4)

- Style resolution order is literal → `defaults[kind].variants[variant]` → `defaults[kind]` → `defaults['*']` → built-in fallback (02 §Style resolution order); an unknown token falls through and reports `FLX_TOKEN_UNKNOWN`, never throws.
- Every string `resolveStyle`, `resolveBackground` and `toCssVars` emit is validated (colours through the schema's `colorSchema`, quoted family names, keyword allow-lists, finite numbers): no document or theme value may carry other CSS (ADR-0015 amendment).
- Token refs become `var(--fx-<path>, <literal fallback>)`, so a theme switch restyles without re-rendering; `cssVarName` is the only mapping from token path to variable name.
