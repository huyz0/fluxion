---
'@fluxion/render': minor
'@fluxion/sdk': minor
---

Pack views can draw themselves on the SVG export: `@fluxion/sdk/export` re-exports `ElementView`, `ElementViewProps`, `Svg`, `ExportContext` and `useExportText`, which lays out a view's text with the host's measurer exactly as the built-in labels are laid out and records its glyphs for the export's fonts. Render stays external in the subpath's build, so every pack reads the host's one context. `@fluxion/render/svg` exports the same contract.
