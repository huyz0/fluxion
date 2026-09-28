---
status: accepted
date: 2026-09-28
decision-makers: Fluxion maintainers
---

# ADR-0015 — Static render path: `<ScreenView>` through `react-dom/server`, content CSS as a string, styles resolved in `theme`

## Context and Problem Statement

R0 ends with `fluxion render doc.flux.json -o out.html` producing one static HTML file in Node on
Windows, macOS and Linux (FR-CLI-001, FR-SCR-001). The same screens will later be drawn live by
the player and the editor, and they must look identical in every mode (FR-EDT-010, 04 §2.6).
M4's plan leaves four questions open:

1. How does Node produce the HTML: server-render the React `<ScreenView>`, or serialize SVG by hand?
2. How does content CSS, written as CSS Modules with `fx-` classes (ADR-0010), reach a Node process
   that has no CSS loader?
3. What does the Node `TextMeasurer` do before text arrives (M7)?
4. Where are resolved styles computed? 04 §2.3 says "a core computed per element", but the
   resolution needs the theme, and `core` (L1) may not import `theme` (L1): 01-overview §3.

A fifth question came up while planning: fixtures name the rectangle `basic:rect`, not the plan's
`core:rect`, so how does a shape reach its view?

## Decision Drivers

- One renderer for edit, present and export (FR-EDT-010): no second drawing path to keep equal.
- Static output: no scripts, no hydration, small, readable in any browser (FR-CLI-001).
- Deterministic output for goldens (NFR-REL-005): same input, same bytes, on every OS.
- Layering stays as 01-overview states it; `check-layering` enforces it.
- Registries, not kind switches (FR-EXT-001, `check-kind-switch`).

## Considered Options

- **A. `react-dom/server` `renderToStaticMarkup(<ScreenView … mode="export">)`**, content CSS
  shipped as a TypeScript string module and inlined by `ssr.ts`.
- **B. A hand-written SVG/HTML serializer** walking the records, sharing nothing with the
  React views.
- **C. Headless browser** (Playwright) rendering the studio and saving the DOM.

## Decision Outcome

Chosen option **A**.

1. **Render path**: `render/src/ssr.ts` exports `renderDocumentToHtml(file, options)`. It builds
   the store with `createCore(file)`, renders each visible screen's `<ScreenView mode="export"
   view={{ kind: 'fit', … }}>` with `renderToStaticMarkup` (no hydration markers, no scripts)
   and wraps the screens in one HTML document. The views are the live views; nothing is drawn
   twice.
2. **Content CSS**: content styles live in `render/src/content-css.ts` as one exported string of
   `fx-`-prefixed rules inside `@layer fx.content` (ADR-0010's prefix; the layer name of 04 §2.3,
   recorded as an ADR-0010 amendment together with the move from CSS Modules). `<ScreenView>`
   uses the class names directly; the browser build injects the same string once
   (`<style data-fx-content>`), and `ssr.ts` inlines it into `<head>`. A CSS Modules loader is
   not needed in any runtime, and SSR and browser use byte-identical CSS. If content CSS outgrows
   one file, a build step may generate the string module from `.css` sources; the contract (a
   string, inlined) stays. Packs add their own content CSS the same way: an `ElementView` may carry
   a `css` string (`fx-` classes of its pack, same layer), and `<ScreenView>` (browser, injected
   once per view) and `ssr.ts` (inlined) emit render's content CSS followed by the `css` of every
   registered view, in registry key order.
3. **Node `TextMeasurer`** in R0: fixed metrics (each character 0.6 em wide, line height 1.2 em),
   used only if a view asks. R0's views do not measure: labels are HTML laid out by the browser
   that opens the file. fontkit-based measurement arrives with text in M7.
4. **Resolved styles**: `theme` exports `resolveStyle(style, kind, theme)` (element literal →
   token ref → theme `defaults[kind]` → theme globals, 02 §2). Token refs become
   `var(--fx-<token>, <literal fallback>)`, so a theme switch restyles without re-rendering. An
   unknown token falls back to the default and reports `FLX_TOKEN_UNKNOWN`. `render` wraps the
   call in core's `computed` per element, which is the "core computed" 04 §2.3 means; `core`
   itself stays free of theme.
5. **Shapes**: the view registered for `kind: 'shape'` looks the element's `defId` up in the
   `shapeDefs` registry to get its outline; `basic:rect` is registered by the render package's
   built-ins in R0 (the `basic` pack takes it over in M5). An unknown `defId` or an unregistered
   kind renders the placeholder view and keeps the record (FR-DOC-005).
6. **Mode**: `export` is a `RenderMode`. `render/src/mode-policy.ts` is the only module that
   reads `mode`, enforced by `scripts/gates/check-mode-policy.mjs`.

### Consequences

- Good, because the CLI output is the player's DOM, so goldens and visual baselines test the
  views every later milestone reuses.
- Good, because SSR, browser and export share one CSS string and one resolution function.
- Good, because `renderToStaticMarkup` is synchronous and deterministic for pure views.
- Bad, because the CLI depends on `react` and `react-dom` (bundled into the CLI's `dist`, MIT).
- Bad, because content CSS is a string without CSS-file tooling (linting, syntax highlighting)
  until a generator is worth it.
- Bad, because views must stay pure and effect-free to render identically on the server:
  layout effects (measurement) are forbidden in export mode by `mode-policy.ts`.

### Confirmation

T1 tests of each view (Chromium), a node test that the SSR HTML has no `<script>` and one
`.fx-screen` per visible screen, normalized SVG goldens rendered twice (byte-identical), the first
visual baseline of the CLI output (pinned Playwright image), and `check-mode-policy`.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| A. React SSR | one renderer; parity by construction; deterministic | React in the CLI |
| B. Hand serializer | tiny; no React in Node | a second renderer to keep pixel-equal with the live one |
| C. Headless browser | exact browser layout | needs a browser in the CLI; slow; not deterministic across OSes |

## More Information

04-rendering-and-editor §2; ADR-0010 (styling isolation); ADR-0001 (own DOM+SVG engine);
01-overview §3 (layering). M4 plan "Decide before coding".

## Amendments

- 2026-09-29 (M4.10 review F1, F2): the theme defaults' shape is `defaults[kind]` with an optional
  `variants[name]` sub-object and the globals under `defaults['*']`, as 02 §Style now states.
  `resolveStyle` validates every value it emits (colours through the schema's `colorSchema`, family
  names quoted and escaped, keywords from their allow-lists, finite numbers) and skips anything else
  to the next layer, so neither a style literal nor a theme default can inject CSS into the rendered
  output.
- 2026-09-29 (M4.14): in R0 the outlines of §5 sit in a render-level `shapeDefs` registry
  (`RenderRegistries.shapeDefs`, a `ShapeOutline` per definition id, returning geometry path
  commands). Core's `shapeDefs` stays untyped until the JSON `ShapeDef` of 03 §5 arrives with the
  basic pack (M5), which replaces the render-level registry. Built-ins (`shape` view, `basic:rect`)
  register as source `core` through `registerBuiltinViews`. `<ScreenView>` defaults to
  `builtinRegistries()`.
