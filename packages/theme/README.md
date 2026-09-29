# @fluxion/theme

Token model (DTCG), token resolution, palette generation (OKLCH), contrast checks, CSS-variable emission.

| Layer | Pure | Status |
|---|---|---|
| L1 | yes | M4: token model, the light theme, CSS variables, style and background resolution |

```ts
import { LIGHT_THEME, resolveStyle, toCssVars } from '@fluxion/theme';

// every token of the theme as a --fx-* CSS variable, for the .fx-screen root
const vars = toCssVars(LIGHT_THEME);
// an element's style resolved against the theme: literal → token → defaults[kind] → defaults['*']
const { style, diagnostics } = resolveStyle({ fill: '{color.primary}' }, 'shape', LIGHT_THEME);
// style.fill → { type: 'color', css: 'var(--fx-color-primary, #2563eb)' }; an unknown token falls
// back through the layers and reports FLX_TOKEN_UNKNOWN
```

Every value `resolveStyle` and `toCssVars` emit is validated, so neither a document nor a theme can
inject CSS (ADR-0015 amendment). Architecture: [docs/architecture/02-document-model.md](../../docs/architecture/02-document-model.md)
§Style resolution order, [01-overview.md](../../docs/architecture/01-overview.md).
