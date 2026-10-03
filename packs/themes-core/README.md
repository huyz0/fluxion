# @fluxion/pack-themes-core

The first-party themes pack: eight built-in themes (FR-THM-003), in the namespace `themes-core`: `light`, `dark`, `corporate`,
`vibrant`, `pastel`, `high-contrast`, `blueprint` and `chalkboard`. It is plain data built with `@fluxion/sdk` only, and a host
registers it into its core registries like any plugin:

```ts
import { themesCorePack } from '@fluxion/pack-themes-core';
import { createCoreRegistries } from '@fluxion/sdk';

const registries = createCoreRegistries();
const registered = themesCorePack.register(registries); // every theme, validated, or diagnostics
registries.themes.get('themes-core:dark'); // the theme
```

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M9: 8 themes |

## Themes

Every theme has the structure of the built-in light theme (typography, spacing, radii, stroke widths, shadows, motion, the
per-kind defaults) with a palette of its own: the 17 colour roles of FR-THM-001. The text and muted colours meet WCAG AA 4.5:1
on the background and the surface (the high-contrast theme 7:1), and the connector colour 3:1 on the background; the pack's tests
measure them with `contrastRatio`. A theme is chosen with `document.setTheme`, which copies it into the document as a `theme`
record (ADR-0152), so a saved file does not depend on the pack.
