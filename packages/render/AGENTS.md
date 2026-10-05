# @fluxion/render — agent notes

React 19 DOM+SVG renderer of a screen, identical in edit and present mode.

## Rules

- Layer L3: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- DOM allowed. Business logic belongs in the pure packages below this layer.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.

## Invariants (M4)

- Only `src/mode-policy.ts` reads the render mode (`check-mode-policy`); edit, present and export are the same components (04 §2.6).
- Element views are looked up in `RenderRegistries` (`elementViews`, `shapeDefs`), never switched on by kind (`check-kind-switch`); an unknown kind or shape definition renders `PlaceholderView` and leaves the record unchanged (FR-DOC-005).
- Views are pure: the same records give the same markup in the browser and through `renderDocumentToHtml` (`@fluxion/render/ssr`, its own entry: the main entry and the one-file player stay free of `react-dom/server`, ADR-0026) (T1 parity test, SVG goldens in `__golden__/`, `vitest -u` rewrites them in the commit that changes the drawing).
- Content CSS is the `CONTENT_CSS` string in `@layer fx.content`, injected once in the browser and inlined by SSR (ADR-0015); per-render ids come from `useId`, and SSR gives each screen an `identifierPrefix`.
- Group and frame members are stored in screen coordinates: their list sits in a `.fx-members` container that undoes the parent's placement.
- A module covered only by browser tests needs a `*.browser.test.tsx` of its own stem (the coverage harness drops browser-covered modules from the node sandbox).
