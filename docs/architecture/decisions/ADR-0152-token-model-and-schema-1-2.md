---
status: accepted
date: 2026-10-03
decision-makers: harness (M9.4; within FR-THM-001, FR-THM-002, FR-THM-004, FR-DOC-006; a minor schema bump with migration and fixture, contracts.md rules 8-9)
---

# ADR-0152 — The token model: required roles checked at validation, derived tokens as DTCG aliases with a transform, an own OKLCH, and schema 1.2 (metadata fields, a screen's theme reference)

## Context and Problem Statement

M9 completes the theme model of M4 and the document metadata of M0. Four things need a decision before code, three of them
contracts. (1) FR-THM-001 asks for a full token set with semantic colour roles, and the record schema must keep round-tripping
tokens it does not know (FR-DOC-005). (2) FR-THM-002 asks for tokens derived from tokens ("`{color.primary}` lightened by
20 % in OKLCH"); the representation is a file-format contract and the computation lands in the player's path (the theme
package resolves styles in every host). The M9 plan names culori for it. (3) FR-THM-004 asks for a per-screen theme override,
and the `screen` record has no field for it. (4) FR-DOC-006 asks for description, tags and custom key-values, and the
`document` record has title, language, authors and the two timestamps only.

## Decision Drivers

- A file written by a newer version must still open and round-trip in an older one (FR-DOC-005): no required-field growth
  in record schemas.
- The player gains no runtime dependency for colour maths (a player dependency needs an ADR, and the colour code is small).
- Theme files stay valid DTCG, so the M20 import and export (FR-THM-009) is a mapping, not a rewrite.
- One representation for a derived colour, the same in the file, the resolver and the CSS-variable emission.
- Schema changes are deliberate: minor bump, migration, fixture, JSON Schema, reference page, API report, changeset.

## Considered Options

Derived tokens:

1. **A `{ from, op }` object as the `$value`.** Direct, but it breaks DTCG readers and tools, which expect a literal or an
   alias there.
2. **A DTCG alias plus an extension.** `$value: "{color.primary}"` with `$extensions["dev.fluxion"].transform` listing the
   operations. A DTCG reader sees the alias (the base colour); a Fluxion reader applies the transform.
3. **Precomputed literals only.** No derivation: a theme switch or a changed primary no longer recolours dependants.

OKLCH:

1. **culori** (MIT). Complete, but a runtime dependency of the theme package, which every host including the player runs.
2. **An own implementation** in `@fluxion/theme`: sRGB to linear to OKLab to OKLCH and back (Ottosson's matrices),
   a gamut clamp by reducing chroma, and the four operations. About 150 lines, pure, tested against reference values
   computed independently.

Metadata:

1. **Use the existing free-form `meta` bag.** No schema change, but user-facing metadata becomes an undocumented convention
   inside a bag meant for tooling data.
2. **Typed optional fields** on `document`, as a minor bump.

Screen override:

1. **`screen.themeId`**, a reference to a `theme` record (the screen uses that whole theme).
2. **A token override map on the screen.** More expressive, but FR-THM-004 needs a screen to keep "its own values" under a
   document-level switch; a whole-theme reference does that, and a token-level map belongs with the theme editor (M20).

## Decision Outcome

- **Required roles live in the theme package, not the record schema.** `@fluxion/theme` exports `REQUIRED_COLOR_ROLES`
  (background, surface, text, muted, primary, secondary, accent-1 to accent-6, success, warning, danger, info, connector) and
  `validateTheme(theme)`, which returns diagnostics with a JSON-pointer path per problem (a missing role, a wrong `$type`,
  an unresolvable alias, a transform that names an unknown operation). The `theme` record schema keeps `tokens` a
  permissive DTCG tree, so a theme with tokens this version does not know round-trips. Typography (families, scale,
  weights, line-heights), spacing, radii, stroke widths, shadows and motion are token groups with the same treatment;
  the roles are required, the other groups are checked for shape when present, and the built-in themes carry all of them.
  **The strict token schema of M4 changes in exactly three ways** (`tokenSchema`, `themeSchema`, `isValidToken` in
  `packages/theme/src/tokens.ts`): (a) a `color` token's `$value` is a literal colour (`colorSchema`) **or** an alias
  string `{path}` of letters, digits, `_`, `-` and `.`; (b) a token may carry `$extensions`, an object whose
  `dev.fluxion` entry is validated (`{ transform: [step, ...] }`, each step one of the four operations with finite numbers
  in range and, for `mix`, an alias in `with`) and whose other entries (from other tools) are kept as unknown JSON and never
  emitted; (c) shadows and motion get `$type`s of their own with shape checks. The M4 safety invariant is kept: no string
  that reaches CSS comes from a document. An alias is never emitted as written: it is resolved to its target's literal or
  its `var()`, and a derived colour is produced by our code from validated numbers as `#rrggbb` or `rgb(r g b / a)`. A
  theme that fails `themeSchema` is refused as before, so the strictness lives in `themeSchema` and `validateTheme` adds
  the role and alias diagnostics on top of it.
- **Derived tokens: option 2.** A derived token is `{ "$type": "color", "$value": "{color.primary}", "$extensions":
  { "dev.fluxion": { "transform": [ { "lighten": 0.2 } ] } } }` (the value may also be a literal colour). The steps are
  applied in order in OKLCH and **mean what CSS `color-mix(in oklch, ...)` means**, because the element-level colour transform
  of M4 emits exactly that, so a derived theme token and a transformed style agree: `lighten n` mixes with white by n
  (L' = L + (1 - L) n, C' = C (1 - n), the hue kept), `darken n` mixes with black (L' = L (1 - n), C' = C (1 - n)), `alpha n`
  multiplies the opacity by n, and `mix` (`{ "with": "{color.accent-1}", "amount": 0.5 }`) mixes with another colour by
  `amount`, the weight of that colour, premultiplied by alpha, along the shorter hue arc, a grey's hue being powerless (its
  chroma below 4e-4: the other colour's hue is used). A result outside sRGB is brought in by reducing chroma at the same
  lightness and hue (not CSS's gamut-mapping algorithm; themes of the pack stay in gamut). **Order and ranges:** the alias
  chain is followed first (aliases of aliases and derived tokens of derived tokens are allowed, resolved recursively), then the
  steps run in array order. `lighten`, `darken` and `alpha` take n in [0, 1] and `mix.amount` is the weight of `with` in [0, 1]
  (0 gives the base, 1 gives `with`); a value outside the range is a diagnostic, not a clamp. The colours that can be derived
  from are hex, `rgb()`, `hsl()`, `oklch()` and `oklab()`; a named colour, `lab()`, `lch()`, `hwb()` or `color()` is a
  diagnostic when a step needs it (a token without steps may still be any colour). A cycle (a token reaching itself through
  aliases or `mix.with`) is the diagnostic `FLX_TOKEN_CYCLE` (error, M9.6); a transform that is not a non-empty list of steps,
  an unknown or doubled operation, an out-of-range number, a `mix` without an alias, or a colour that cannot be derived from is
  `FLX_TOKEN_TRANSFORM` (error, M9.7). Resolution keeps the chain of links followed (aliases and `mix.with`), so a cyclic
  theme is reported, never looped over, and the chain is bounded (64). The resolver computes a derived token to a literal
  colour when it emits CSS variables (`toCssVars`), so a theme or primary change re-derives every dependant; the emitted
  variable is a plain `#rrggbb` or `rgb(r g b / a)`, so a derived token of a derived token is quantised to 8 bits between
  links (the exact OKLCH of one derivation is `deriveOklch`).
- **OKLCH: option 2.** The implementation is in `@fluxion/theme` (pure, no dependency). culori of the plan is not added: the
  player resolves styles through this package, so it would become a player dependency for a few conversions. Reference
  values are computed independently of the implementation (the OKLab definition, evaluated with a separate script) and
  stored as fixtures with ε = 1e-3 in OKLCH.
- **Metadata: option 2.** `document` gains optional `description` (string), `tags` (array of strings) and `custom`
  (object of string values). `modified` is set by `document.updateMeta` through the `Clock` port.
- **Screen override: option 1.** `screen` gains optional `themeId` (a record id). The reference check requires it to name a
  `theme` record (FLX_REF_MISSING with a suggestion, as `sectionId`). A screen without it uses the document's theme.
  `document.setTheme` and `screen.setThemeOverride` write the chosen theme into the document as a `theme` record when it is
  not there yet, so the file stays self-contained and portable. **The id** is `theme-<slug>`, the slug being the pack
  theme's name lower-cased with every run of characters outside `a-z0-9` turned into `-` (at most 59 characters, so the
  id fits the 64 of `recordIdSchema`); a document's own themes are never given that prefix by the commands. **Collision:**
  if a record with that id exists the command uses it as it is and never overwrites it, so a theme the user edited keeps
  its edits and switching back and forth never duplicates a record; taking a pack's newer version is an explicit action of
  the theme editor (M20).
- **Schema 1.2.** The version becomes `1.2`. Records are loose, so a 1.1 file may already carry values in the new places
  that the typed fields would refuse. The migration `1.1 to 1.2` therefore **normalises**, as `1.0 to 1.1` did for
  `sectionId`: it removes a `description` that is not a string, `tags` that is not an array of strings, `custom` entries
  whose value is not a string (the object goes if it is not an object), and a `screen.themeId` that is not a string or names
  no `theme` record. Everything else passes through. M9.5 delivers the migration, a `fixtures/v1.2` document with metadata and
  a screen override, a `fixtures/migration/nonconforming-1.1.flux.json` document that carries each bad value and migrates
  to a valid 1.2 one, the regenerated JSON Schema, the format reference page, the API report and a changeset, and
  `02-document-model.md`. That page's document and screen rows change in M9.5's commit, with the schema, not in this one:
  `docs-consistency` refuses a model page that names a field the schema does not have, so until M9.5 this ADR is the contract
  for the four fields (its theme row and the derived-token paragraph, which name no field, are updated with this ADR). A reader of 1.1 keeps the fields it does not know (FR-DOC-005).

### Consequences

- Good: the player gains no dependency; the representation of a derived colour is valid DTCG, so M20 maps rather than
  rewrites; theme files with unknown tokens still round-trip.
- Good: the screen override is one reference and one reference check, undoable as one record change.
- Neutral: a derived token's alias is visible to non-Fluxion DTCG tools as the base colour only (they ignore the
  transform), which is the safe reading.
- Bad: we own the OKLCH code and its gamut clamp; a gamut-mapping subtlety (chroma reduction, not a CSS gamut map) differs
  slightly from browsers' `oklch()` rendering for out-of-gamut values; themes shipped with the pack stay in gamut.
- Bad: a theme copied into the document duplicates its tokens in every file that uses it (a few kilobytes).

### Confirmation

- T0 "FR-THM-001: a missing role is a diagnostic naming its path"; "the built-in light theme validates" (M9.6); every pack
  theme validates (M9.8).
- T0 "FR-THM-002: a derived token lightened by 20 percent in OKLCH matches the reference values within 1e-3" and "follows
  its source token when the theme changes" (M9.7); the player bundle's size is unchanged by the colour code beyond its few
  hundred bytes (size-limit).
- T0 "FR-DOC-006: a 1.1 document migrates to 1.2 and round-trips"; "FR-DOC-006: a 1.1 document with non-conforming new
  fields migrates to a valid 1.2 one"; "FR-THM-004: a screen's theme reference round-trips and must name a theme record"
  (M9.5).
- T0 "FR-THM-002: a theme with a cycle is reported as FLX_TOKEN_CYCLE and does not loop"; "a derived token keeps its
  alias and transform through `themeSchema`" (M9.6, M9.7).

## More Information

14-theme-text-media (FR-THM-001..004), 10-document-and-file (FR-DOC-005, FR-DOC-006), 02-document-model §2 and §3,
ADR-0015 (style resolution and CSS variables), ADR-0021 (the precedent: a record and a reference at schema 1.1),
contracts.md rules 8 and 9, the M20 plan (DTCG import and export, theme editor).
