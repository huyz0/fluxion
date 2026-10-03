# @fluxion/pack-fonts-core

The bundled fonts (FR-THM-008, ADR-0022): **Inter** (sans), **Source Serif 4** (serif) and **JetBrains Mono** (mono), Latin
subset, weights 400 and 700, upright and italic, all under the SIL Open Font License 1.1 (`OFL.txt`; the copyright lines are
in `fonts.json` and travel with the bytes). The files come from the pinned `@fontsource` packages: `node scripts/fonts/vendor.mjs`
fetches them and checks the registry's integrity, `--check` fails when a file differs.

```ts
import { FONTS_CORE, fontUrl } from '@fluxion/pack-fonts-core';
import { createFontRegistry } from '@fluxion/theme';

const fonts = createFontRegistry();
fonts.register(FONTS_CORE);
fontUrl(FONTS_CORE[0], new URL('../', import.meta.url)); // where the file is served
```

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M9: 3 families, 12 files |

A host loads a face with `loadFontFaces` of `@fluxion/render`, which adds a `FontFace` to the page and empties the measurer cache
when it has loaded. The player never loads this pack unless a document uses its fonts.
