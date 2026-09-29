# @fluxion/render

React 19 DOM+SVG renderer of a screen, identical in edit and present mode.

| Layer | Pure | Status |
|---|---|---|
| L3 | no | M4: `<ScreenView>`, backgrounds, element views (rect shape, straight connector, placeholder), static HTML, SVG goldens |

```tsx
import { createCore } from '@fluxion/core';
import { renderDocumentToHtml, ScreenView } from '@fluxion/render';

// in the browser: one screen of a live store, fitted into a box
const { store } = createCore(file);
<ScreenView store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 960, h: 540 } }} />;

// on a server or in the CLI: the whole document as one static page, no script
const html = renderDocumentToHtml(file);
```

`react` and `react-dom` are peer dependencies (one React per host). Element views are looked up in
registries (`createRenderRegistries`, `registerBuiltinViews`), never switched on by kind.
Architecture: [docs/architecture/04-rendering-and-editor.md](../../docs/architecture/04-rendering-and-editor.md) §2,
ADR-0015 (static render path).
