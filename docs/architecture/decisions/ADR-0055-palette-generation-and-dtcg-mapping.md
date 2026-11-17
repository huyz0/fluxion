---
status: accepted
date: 2026-11-17
decision-makers: harness (M20.2, under Huy's 2026-11-05T11:04:52Z delegation), subject to independent review
---

# ADR-0055 — Palette generation, theme variants and the DTCG mapping

## Context and Problem Statement

M20 makes themes a studio feature. Three behaviours need a contract before code. (1) FR-THM-005: generate an accessible palette
from 1–3 seed colours or an image, with contrast checks and lock/shuffle; the plan names culori. (2) FR-THM-006: per-kind default
styles with the variants `primary`, `subtle`, `outline`, `emphasis` selectable by name. (3) FR-THM-009: DTCG import/export and a
CSS-variable export. ADR-0152 already fixed the token model (17 required colour roles, DTCG-shaped tree, derived colours as
aliases with a `dev.fluxion` transform) and an in-house OKLCH in `packages/theme/src/oklch.ts`.

Already in the code: `oklch.ts` parses colours, converts sRGB ↔ OKLCH, clamps to gamut by chroma and computes WCAG luminance
and `contrastRatio`; `Style.variant` exists (schema, DSL `tone:`, patch) and `resolveStyle` reads `defaults[kind].variants[v]`;
the record's `defaults` is an open tree; no built-in theme defines a variant; defaults are keyed by element kind, not by shape
definition (`flowchart:decision`); `cssVarName` maps a path to `--fx-<path joined by ->`. `theme` is pure and the player bundles it.

## Decision Drivers

- FR-THM-005 acceptance: every generated text/background pair ≥ 4.5:1 (WCAG AA); NFR-A11Y-005: text 4.5:1, large text and
  strokes 3:1 — the generator and the M20.10 linter use one set of thresholds.
- FR-THM-006: `variant: "emphasis"` set by AI (FluxScript or patch) gets a themed style; a theme edit restyles with no element change.
- FR-THM-009 / FR-THM-007: DTCG fixture round-trips equal; an exported theme re-imports deep-equal.
- Pure core (AGENTS.md rule 5, tech-stack rule 6): no randomness, DOM or image decoding in `theme`; results deterministic for a seed.
- Player size (tech-stack rules 4, 5, 8; ADR-0152): no player dependency for colour maths; generator code must not reach the player.
- Contracts change deliberately (rule 6; FR-DOC-005): avoid a schema minor unless the record shape must change.

## Considered Options

- **Colour maths.** (1) *culori* (MIT): complete, but `theme` is in the player's graph, so it becomes a player dependency (ADR,
  license entry, size justification) replacing code that exists; ADR-0152 declined it. (2) *Extend `oklch.ts`* (chosen): every
  primitive is there; adds an OKLab accessor, a seeded PRNG and the solver (~250 pure lines); we own k-means, no CVD simulation.
- **Palette shape.** (1) *Radix-style 12-step ramps per hue* (research 04 §C.2): richer, but ~100 more tokens per theme and a tier
  the token model lacks. (2) *Role-direct* (chosen): compute the 17 required roles, then repair; ramps can come later as an
  optional `color.scale.*` group with no contract change.
- **Variant storage.** (1) *`defaults[kind][variant]`* (the plan's notation, read literally): variant names share a namespace with
  style fields (`fill`, `font`), so a variant `fill` is ambiguous; needs a schema minor, a migration of existing `variants` and a
  resolver change, for no gain. (2) *Keep the shipped `defaults[kind].variants[name]`* (chosen): resolver, tests and 02 already use
  it, and the open record tree takes per-definition keys too, so no schema change.

## Decision Outcome

### Colour maths and module layout

No culori. New pure modules in `packages/theme/src`: `rng.ts` (sfc32 seeded by splitmix32, the algorithm of ADR-0034, copied
rather than imported, since `theme` may not depend on `layout`; `Math.random` stays forbidden), `contrast.ts` (`CONTRAST_TEXT = 4.5`,
`CONTRAST_GRAPHIC = 3`, the pair tables, the L solver), `palette.ts`, `palette-image.ts`, `variants.ts`, `dtcg.ts`, `css-export.ts`.
The player reaches only `variants.ts` (the built-in variant table, data that `light.ts` spreads into `LIGHT_THEME`) and the
extra resolver layer; the generator, image, DTCG and CSS-export modules are tree-shaken out (`sideEffects: false`).

### Seed → palette

`generatePalette({ seeds, locks?, shuffle? }) → Result<Palette, ThemeError>`. `seeds`: 1–3 CSS colours readable by `parseColor`;
otherwise `PALETTE_INPUT`. `Palette = { colors: Record<Role, '#rrggbb'>, adjusted: Role[], unmet: ContrastMiss[] }` over the
roles of `REQUIRED_COLOR_ROLES`. Initial colours (OKLCH; h1/c1 = seed 1):

| Roles | Initial colour |
|---|---|
| `primary` | seed 1, gamut-clamped |
| `secondary`, `accent-1` | seed 2, seed 3 when given |
| other of `secondary`, `accent-1…6` (the 7 hue slots) | slot j: hue h1 + 137.5°·j (golden angle), C = clamp(median seed C, 0.08, 0.17), L 0.62 |
| `background` / `surface` | hue h1, L 0.99 / 0.97, C 0.004 / 0.008 |
| `text` / `muted` / `connector` | hue h1, C 0.02, L 0.22 / 0.48 / 0.40 |
| `success` / `warning` / `danger` / `info` | fixed hues 145° / 70° / 25° / 240°, C 0.14, L 0.62 |

**Contrast repair.** Roles are solved in the order of the table below; each role's constraints name only roles earlier in the order,
so one pass suffices and nothing cycles. For a role, the feasible set of L (C and H kept, chroma re-clamped to gamut at each L) is
the intersection of its constraints; the solver takes the feasible L nearest the initial L, finding each constraint boundary by
bisection (32 steps) to target + 0.02, then checks the quantised `#rrggbb` and nudges L away from the anchor by 0.002 up to 8 times.
Every constraint "≥ r against a fixed anchor" is satisfiable for r ≤ 4.58 (black or white reaches it against any colour), and the
accent band below (Y ∈ [4.52·(Y_text + 0.05) − 0.05, 1.02/3.02 − 0.05 ≈ 0.288] with the margins) is non-empty while `text` has
Y ≤ 0.0247, i.e. L ≲ 0.29 for a neutral, and the generator puts `text` at L 0.22; so **without locks `unmet` is always empty**.

| Role | Must reach | Why (built-in variants and defaults below) |
|---|---|---|
| `text`, `muted` | 4.5 vs `background`, `surface` | body text |
| `connector` | 3 vs `background`, `surface` | strokes |
| `primary`, `secondary` | 4.5 vs `background`, `surface` | `outline` label in primary; `background`-coloured label on `primary`/`emphasis` fills |
| `accent-1…6`, status roles | 3 vs `background`; `text` 4.5 on them | fills and strokes of per-definition defaults with `text` labels |

The adjusted roles are listed in `adjusted` (the editor shows "adjusted for contrast"). **Failure:** contrast never throws; a
constraint that cannot be met (only possible when locked colours make it empty) yields the closest L and a `ContrastMiss { role,
against, ratio, target }` in `unmet`.

**Lock and shuffle.** `locks: Partial<Record<Role, string>>` sets a role verbatim (no gamut clamp, no repair); it becomes an anchor,
and an unlocked partner is solved against it. `shuffle: uint32` (default 0 = canonical): a Fisher–Yates permutation drawn from
`rng(shuffle)` over the **unlocked** members of the hue slots (`secondary`, `accent-1…6`); a locked slot keeps its position.
Primary, neutrals and status roles are never shuffled. Same `(seeds, locks, shuffle)` ⇒ byte-identical palette. The studio's
Shuffle increments the number; it is never stored in the document. `applyPalette(theme, palette)` writes the 17 role tokens as
literals (keeping `$description`; an alias or derived role token becomes a literal), so derived tokens follow via ADR-0152.

### Image → palette

`paletteFromPixels({ width, height, data: RGBA bytes }, { seed = 0x5eed })` returns the seeds for `generatePalette`. Decoding
stays outside the package: the editor decodes with `createImageBitmap` to ≤ 256 px longest side and passes `ImageData`'s fields;
`data.length ≠ w·h·4` or more than 16 Mpx is `PALETTE_INPUT`. Steps: box-average downscale to ≤ 64 px longest side (aspect kept);
drop pixels with alpha < 128; points in OKLab; **k-means, k = 5**, k-means++ initialisation from `rng(seed)`, Euclidean distance,
at most 16 iterations or until no assignment changes, ties to the lowest index, an empty cluster re-seeded with the point farthest
from its centroid. Seed 1 = the cluster maximising weight·C among those with C ≥ 0.03; seeds 2 and 3 = the next by weight·C whose
hue is ≥ 30° from the seeds already taken. An image with no chromatic cluster gives one seed, the light theme's `primary`.
Determinism is exact per host; across engines `Math.cbrt`/`**` may differ in the last ulp, which the 8-bit output absorbs except at
a rounding boundary (the fixture test runs in Node).

### Per-kind defaults and variants

Shape unchanged: `theme.defaults[key] = { …style fields, variants?: { [name]: Style } }`. Keys are element kinds (`shape`,
`connector`, `text`, `frame`, `image`, `table`, `screen`, `*`) and, **new**, shape definition ids (`flowchart:decision`). Per field,
first valid value wins:

1. the element's literal or token ref; 2. `defaults[defId].variants[v]`; 3. `defaults[kind].variants[v]`; 4. `defaults[defId]`;
5. the definition's `defaultStyle` (ADR-0016); 6. `defaults[kind]`; 7. `defaults['*']`; 8. built-in fallbacks.

`v` is the element's `style.variant`, else its definition's. An unknown variant name falls through silently (rendering never
fails); flagging it in lint is a backlog row, not this ADR. Variant names are open (`literalName`); every built-in theme (light
and the themes-core pack) ships these four, as token refs so a theme edit restyles by CSS variables alone:

| Variant | `shape` (and `frame`) | `connector` | `text` |
|---|---|---|---|
| `primary` | fill, stroke `{color.primary}`; font colour `{color.background}` | stroke `{color.primary}` | colour `{color.primary}` |
| `subtle` | fill `{color.surface}`; stroke `{color.muted}` `{stroke.thin}`; font `{color.text}` | stroke `{color.muted}` `{stroke.thin}` | colour `{color.muted}` |
| `outline` | fill `transparent`; stroke `{color.primary}`; font `{color.primary}` | stroke `{color.primary}`, dash `[6, 4]` | colour `{color.primary}`, weight 400 |
| `emphasis` | fill, stroke `{color.secondary}` `{stroke.thick}`; font `{color.background}`, weight 700 | stroke `{color.secondary}` `{stroke.thick}` | weight 700, colour `{color.text}` |

**No schema change**: the record already accepts these keys, so there is no schema minor and no migration. A theme that used a
definition id as a `defaults` key before this change starts applying it — accepted (no shipped theme or fixture does). `validateTheme`
reports a `variants` entry that is not an object. M20.7 updates the resolution-order paragraph of 02-document-model in its commit.

### DTCG mapping (DTCG 2025.10) and theme files

A theme file (`<name>.tokens.json`) is the DTCG export, written by `exportDtcg` in `theme`. It is separate from the `.flux`
container's `theme/tokens.json` entry, which is **unchanged**: `format` keeps writing `canonicalJson(themeTokens(doc))` (the record's
`tokens` as stored; `flux-writer.ts`, `flux-json.ts`), since `format` may depend only on `schema` and `core` and its bytes change
only with fixtures. That entry is DTCG-shaped but not this export (no colour objects, no root extension). Root of a theme file:
`$extensions["dev.fluxion"] = { version: 1, name, defaults?, tableStyles? }`; token refs inside them keep the `{path}` syntax.

| Theme token (`$type`) | DTCG `$value` on export | Import accepts |
|---|---|---|
| `color` literal | `{ colorSpace: "srgb", components: [r,g,b] (4 dp), alpha, hex: "#rrggbb" }` from hex/`rgb()`/`hsl()`/named; `"oklch"` / `"oklab"` components from those functions | `srgb`: RGB from `hex` when present (else components), alpha from `alpha` — `#rrggbb` at 1, else `#rrggbbaa` with aa = round(alpha·255) (export writes alpha = aa/255 to 4 dp, which recovers aa exactly); `oklch`, `oklab`; other spaces → `DTCG_UNSUPPORTED` |
| `color` alias / derived | `"{path}"` + `$extensions.dev.fluxion.transform` (ADR-0152), unchanged | same |
| `dimension` | `{ value, unit: "px" }` | `px`; `rem` × 16 px (warning) |
| `fontFamily`, `fontWeight`, `number`, `cubicBezier` | unchanged | `fontWeight` names with their aliases (`thin`/`hairline` 100 … `black`/`heavy` 900, `extra-black`/`ultra-black` 950) |
| `shadow` | `color` as above; offsets, blur, spread as `{ value, unit: "px" }` | single shadow; an array → `DTCG_UNSUPPORTED` |
| `duration` | `{ value, unit: "ms" }` | `ms`; `s` × 1000 |
| `$description`, other `$extensions` | unchanged | same |

When the CSS text of a literal colour differs from what import would rebuild from the object (a named colour, `hsl()`, percentage
`rgb()`), export also writes `$extensions["dev.fluxion"].css` with the original text, so theme → DTCG → theme is lossless; a
148-entry named-colour value table lives in `dtcg.ts` (editor/CLI path only). `currentcolor` cannot be exported (warning, token
omitted). Import resolves group-level `$type` onto tokens and writes `$type` on every token (canonical form); group `$description`
and `$extensions`, `$extends`, `$ref` and the types `typography`, `border`, `gradient`, `transition`, `strokeStyle` are dropped with
`DTCG_UNSUPPORTED` warnings naming the path; so are `$root` tokens and `$deprecated` (ignored, warned). The DTCG 2025.10 details
here (colour-object fields, weight names, `$root`, `$deprecated`, `$extends`, `$ref`) are to be verified against the spec in M20.9.

**Foreign files.** `importDtcg(json, { name?, fileName?, base = LIGHT_THEME })`. A file with the root `dev.fluxion` entry is a
Fluxion theme file, read as is (no base; an invalid one is `DTCG_INVALID`). Any other file (Tokens Studio, Style Dictionary,
Figma) is merged onto `base` in these steps. Each step drops or renames, never fails, so a typical ramp file imports with warnings:

1. **Shape.** `base` paths keep their shape. A foreign group where `base` has a token (a ramp `color.primary.500` against the
   required token `color.primary`) moves to `<path>-ramp` (`color.primary-ramp.500`); a foreign token where `base` has a group
   moves to `<path>-value`. A taken name gets `-2`, `-3`… Aliases into a moved subtree are rewritten. Warning `DTCG_PATH_RENAMED`.
2. **Type.** A foreign token at a path `base` has, with a different `$type` (`font.size.md` typed `number`), is dropped
   (`DTCG_TYPE_MISMATCH`). A new path keeps its type only when it matches the type `validateTheme` requires for its group prefix (`GROUP_TYPES`: `color.`, `space.`, `font.size.` …); otherwise it is dropped with `DTCG_TYPE_MISMATCH` too (review r3 F1).
3. **Overlay.** The remaining tokens replace or add to `base.tokens` by path; of two paths with one `--fx-` name the later in tree
   order is dropped (`DTCG_UNSUPPORTED`).
4. **References.** An alias or `mix.with` whose chain reaches a missing or dropped token, or cycles, and a bad `dev.fluxion`
   transform, drop the token (`DTCG_ALIAS_BROKEN`), repeated until nothing more drops.
5. **Roles.** For a required role whose `color.<role>` is not a foreign colour token, the candidates are, in order: the role's
   own moved ramp (`color.<role>-ramp`), then a fixed name list (each under `color.`): `background` ← `bg`, `background.default`,
   `canvas`; `surface` ← `surface.default`, `background.subtle`; `text` ← `foreground`, `fg`, `text.default`, `text.primary`;
   `muted` ← `text.muted`, `text.secondary`, `fg.muted`; `primary` ← `brand`, `brand.primary`, `primary.default`, `accent`;
   `secondary` ← `brand.secondary`, `secondary.default`; `danger` ← `error`, `critical`; `success` ← `positive`; `warning` ←
   `caution`; `info` ← `informative`. Only colour-typed candidates count. A colour token is taken; a group of colour tokens (a
   ramp) gives its step `500`, else, when every step name is a number, the median step (the lower of two), else the middle step in
   tree order. The role becomes an alias to the chosen path (`DTCG_ROLE_MAPPED` names it). A role with no candidate keeps
   `base`'s value (`DTCG_ROLE_DEFAULTED`).
6. **Finish.** `defaults` and `tableStyles` come from `base`; the name is `name`, else the `fileName` stem, else `imported`. The
   theme goes through `themeSchema` + `validateTheme`; after steps 1–5 that can fail only on an internal error, reported as
   `DTCG_INVALID` (also used for input that is not a JSON object).

New `ThemeErrorCode`s (additive): `PALETTE_INPUT`, `DTCG_INVALID`. Warning codes on the import result: `DTCG_UNSUPPORTED`,
`DTCG_PATH_RENAMED`, `DTCG_TYPE_MISMATCH`, `DTCG_ALIAS_BROKEN`, `DTCG_ROLE_MAPPED`, `DTCG_ROLE_DEFAULTED`.

### CSS-variable export

`themeToCss(theme, { selector = ':root' })` emits `toCssVars` (the runtime's own emission, so studio and export agree): one
`--fx-<path segments joined by ->: <value>;` per valid token in tree order — `--fx-color-primary`, `--fx-font-size-md`,
`--fx-motion-duration-fast` — two-space indent, LF, trailing newline, a leading `/* theme: <name> */` comment. Aliases and derived
colours are emitted as their resolved literal; `defaults` and variants are not CSS. Path collisions are already refused by
`themeSchema`.

### Consequences

- Good: no new dependency anywhere; the player gains only the variant data; one contrast table serves generator, variants and linter.
- Good: variants and per-definition defaults need no schema minor, and AI's `variant:`/`tone:` already reaches the resolver.
- Good: theme files are plain DTCG, readable by Style Dictionary, Tokens Studio, Figma, Penpot; Fluxion data stays in one extension.
- Bad: we own k-means and the L solver; generated accents cluster near L 0.62–0.66 (the AA band), so palettes are less varied than
  hand-made ones; dark-mode generation waits for FR-THM-010 (M29).
- Bad: DTCG import is lossy for composite types we do not model (reported, not silent).

### Confirmation

- `packages/theme/src/palette.prop.test.ts` (FR-THM-005): over random 1–3 seeds at the CI seed, every text pair ≥ 4.5:1 and every
  graphic pair ≥ 3:1 on the emitted hex, `unmet` empty; a locked role keeps its colour through any shuffle; same input ⇒ same palette.
- `packages/theme/src/palette-image.test.ts` (FR-THM-005): a fixture image gives the same palette twice and its AA pairs hold.
- `packages/theme/src/variants.test.ts` and `packages/render/src/variant-style.browser.test.tsx` (FR-THM-006): the 8-layer order;
  `variant: emphasis` via FluxScript and via patch renders the theme's style; a theme edit restyles with no element change.
- `packages/theme/src/theme-file.test.ts` (FR-THM-007): each built-in theme exports and re-imports deep-equal.
- `packages/theme/src/dtcg.test.ts` (FR-THM-009): the fixture is canonical (every token typed, the root `dev.fluxion` entry,
  colours as export writes them) and `export(import(x))` equals it; for a non-canonical file (group `$type`, no extension)
  `export(import(·))` is a fixpoint after one pass; each warning code has a case; a foreign file without roles imports onto `base`;
  a Tokens Studio-style ramp fixture (`color.primary.100…900`, a mistyped `font.size.md`, a new `space.4` typed `number`, a broken alias) imports with the
  expected warnings, `color.primary` aliasing `{color.primary-ramp.500}`, and never `DTCG_INVALID`.
- `packages/theme/src/__golden__/theme.css`: `themeToCss(LIGHT_THEME)` matches byte for byte.
- size-limit: the player entry grows by the variant table and the resolver layer only (gzip delta stated in the commit, < 1 kB);
  no palette/DTCG symbol in the player bundle; `check-layering` green for `theme` (no `Math.random`, DOM or `node:*`).

## More Information

- ADR-0152 (token model, own OKLCH), ADR-0010/ADR-0015 (`--fx-` variables), ADR-0016 (`defaultStyle`), ADR-0034 (sfc32),
  ADR-0054 (table styles); research 04 §C; docs/requirements/14-theme-text-media.md.
- Amends docs/architecture/01-overview.md:36, "palette generation (OKLCH/culori)" → "(OKLCH, in-house; ADR-0055)".
