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
