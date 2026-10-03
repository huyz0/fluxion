---
'@fluxion/theme': minor
'@fluxion/schema': minor
'@fluxion/cli': minor
---

Derived colour tokens (ADR-0152): a colour token may carry `$extensions["dev.fluxion"].transform`, steps `lighten`, `darken`, `alpha` and `mix` applied in OKLCH with an own implementation (`parseColor`, `deriveOklch`, `oklchToCss`, `rgbToOklch`), meaning what CSS `color-mix(in oklch, ...)` means; `toCssVars` emits the result as a literal colour. `themeDiagnostics` reports a theme's problems as catalogued diagnostics, and `FLX_TOKEN_TRANSFORM` joins the catalogue (so it is also in the `--json` output schemas of `fluxion`, `render` and `validate`).
