---
"@fluxion/theme": minor
"@fluxion/sdk": minor
---

DTCG import and CSS export (FR-THM-009, ADR-0055). `importDtcg` now reads any DTCG 2025.10 file (Tokens Studio, Style Dictionary, Figma): without the Fluxion root entry, it is merged onto a base theme (`options.base`, default light) in ADR-0055's six steps: group `$type` resolved onto tokens, `rem`/`s` converted, colliding paths renamed (`color.primary.500` → `color.primary-ramp.500`), mistyped and broken tokens dropped, and each required colour role aliased to the file's own name for it. Every change is a warning (`DtcgWarningCode`); the import does not fail. `themeToCss(theme, { selector })` writes the theme's tokens as a CSS custom-property stylesheet.
