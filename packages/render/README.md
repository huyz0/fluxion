# @fluxion/render

React 19 DOM+SVG renderer of a screen, identical in edit and present mode.

| Layer | Pure | Status |
|---|---|---|
| L3 | no | M4: `<ScreenView>`, backgrounds, element views (shape, straight connector, placeholder), static HTML, SVG goldens; M5: shapes from core `ShapeDef`s the host's packs register |

```tsx
import { createCore } from '@fluxion/core';
import { basicPack } from '@fluxion/pack-basic';
import { builtinRegistries, ScreenView } from '@fluxion/render';
import { renderDocumentToHtml } from '@fluxion/render/ssr'; // the static page: its own entry, so the browser bundle never holds react-dom/server
import { createCoreRegistries } from '@fluxion/sdk';

// shapes come from the host's core registries, where its packs register (ADR-0016, ADR-0017)
const core = createCoreRegistries();
basicPack.register(core);
const registries = builtinRegistries(core.shapeDefs);

// in the browser: one screen of a live store, fitted into a box
const { store } = createCore(file);
<ScreenView store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 960, h: 540 } }} registries={registries} />;

// on a server or in the CLI: the whole document as one static page, no script
const { html, screens } = renderDocumentToHtml(file, { registries }); // screens: the ids it drew
```

`react` and `react-dom` are peer dependencies (one React per host). Element views are looked up in
registries (`createRenderRegistries`, `registerBuiltinViews`), never switched on by kind.
Architecture: [docs/architecture/04-rendering-and-editor.md](../../docs/architecture/04-rendering-and-editor.md) §2,
ADR-0015 (static render path).

### Bounded SVG paint witness

`@fluxion/render/svg-witness` exports `createSvgPaintWitness({ document, theme, fonts, signal? })`.
It returns a `Result` containing an owned `{ witness, dispose }` session. Pass `witness` to
format's SVG importer and always call `dispose` in `finally`. Construction snapshots the
validated theme, exact font bytes and the host body's inherited color/typography; rendering
initializes lazily in a same-origin, script-disabled frame with a restrictive resource policy.

The initial font profile is `inter-latin-400-ascii`: the pinned Inter normal-400 bytes and
ASCII 32–126. Font metadata includes family, weight, style, SHA256, bytes and profile. Missing
faces, wrong bytes, unsupported glyphs or CSS family interpretation mismatches refuse rather
than attest fallback text. Hosts retain the font's license and portable assets separately.

One session admits at most 128 requests, one at a time, with a ten-second request deadline
inside a 120-second lifetime. Invalid, concurrent, cancelled or unsupported requests do not
produce positive evidence. Limits include eight faces/8 MiB total font bytes, bounded theme
input, canonical 1024-side rasters and a conservative 16 MiB serialization cap. The host CSP
must permit the documented same-origin frame/styles/data resources; there is no permissive
fallback. This entry has no import-time DOM effects and does not add witness code to the
main renderer entry. The Node bridge and full importer-host corpus qualification are separate.
