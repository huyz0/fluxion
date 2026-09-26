---
status: accepted
date: 2026-09-27
decision-makers: harness (M1.17; tool compatibility within the tech-stack intent)
---

# ADR-0139 — Story tests through portable stories until `@storybook/addon-vitest` supports Vitest 5

## Context and Problem Statement

tech-stack.md names "Storybook + addon-vitest + a11y addon 10.6.x: every story is also a browser
test", and M1.17 asks for one editor story that passes with 0 axe violations. The repo runs
Vitest 5 (M1.12). The latest stable `@storybook/addon-vitest` (10.6.0) declares
`vitest: ^3.0.0 || ^4.0.0` and `@vitest/browser-playwright: ^4.0.0`; only an 11.0 alpha exists.
Installing it would mean a peer mismatch (autoInstallPeers is off, so it would break at run time)
or downgrading the whole test stack.

## Considered Options

1. Downgrade Vitest to 4 for the addon.
2. Install the addon against Vitest 5 anyway.
3. Portable stories: `composeStories` renders each story (with its args and decorators) in a
   `*.browser.test.tsx` in the existing Vitest browser project, and axe-core checks the result.

## Decision Outcome

**Option 3.** Storybook 10.6 (`@storybook/react-vite`, `@storybook/addon-a11y`) is installed for
authoring and the UI; each stories file gets a sibling browser test that composes its stories and
asserts 0 axe violations. "Every story is also a browser test" holds; only the runner differs.
Revisit when a stable `@storybook/addon-vitest` accepts Vitest 5: switching is additive (the addon
generates the same tests) and the sibling test files can then be removed.

## Consequences

- Good: one test runner and one browser provider; story tests count toward the editor's coverage
  floor.
- Bad: a stories file needs its sibling test by hand (review checks it) until the addon returns.

## Confirmation

`pnpm --filter @fluxion/editor test:storybook` runs the story tests (m1-complete leg
"storybook story test passes"); `EmptyState.browser.test.tsx` fails on an axe violation.
