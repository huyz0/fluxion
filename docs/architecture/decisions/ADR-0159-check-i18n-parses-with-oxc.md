---
status: accepted
date: 2026-10-06
decision-makers: harness (M9.19; amends one sentence of ADR-0023, adds a development dependency, no contract change)
---

# ADR-0159 — `check-i18n` parses JSX with `oxc-parser`

## Context and Problem Statement

ADR-0023 says `scripts/gates/check-i18n.mjs` "parses every `.tsx` of the packages with UI with the TypeScript compiler API". The repository's TypeScript is 7 (`typescript: 7.0.2`), which ships no JavaScript compiler API; `dependency-cruiser` is given TypeScript 6 through a package extension for that reason (ADR-0011). The gate needs a JSX parser it can import from a Node script.

## Decision Outcome

`check-i18n` parses with **`oxc-parser`** (MIT, the parser behind Vite 8's Oxc, already a transitive dependency of the toolchain; pinned at 0.151.0, a development dependency of the root only). It returns an ESTree-shaped tree with JSX nodes; the gate walks it for JSX text children and for string literals in `aria-label`, `title`, `placeholder`, `alt` and `label`, as ADR-0023 says. Nothing else of ADR-0023 changes: the allowlist, the exemption for symbols and digits, the `<Trans>` exemption (the macro takes its children as the message) and the negative fixture. A second TypeScript copy for one script was the alternative; it adds a package that nothing else wants.

## Consequences

- Good: no second TypeScript; the parser is the one Vite already runs.
- Neutral: `oxc-parser` is pre-1.0; the gate is its only caller, so a break is one file.

## Confirmation

`tests/harness/i18n.test.mjs`: "NFR-I18N-001: a JSX string literal outside the allowlist fails check-i18n" and its neighbours; `check-licenses` and `knip` pass with the dependency.
