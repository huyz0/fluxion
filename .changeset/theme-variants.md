---
"@fluxion/theme": minor
"@fluxion/render": patch
---

Theme variants (FR-THM-006, ADR-0055). Every built-in theme ships `primary`, `subtle`, `outline` and `emphasis` for shapes, frames, connectors and text as token refs (`BUILTIN_VARIANTS`), so `variant: emphasis` (FluxScript `tone: emphasis`) gets the theme's style and a theme edit restyles it. `resolveStyle` takes a shape definition id (`StyleKind.defId`): the theme's `defaults[defId]` and its variants apply, in the eight-layer order of ADR-0055. `validateTheme` reports a variant that is not a style object.
