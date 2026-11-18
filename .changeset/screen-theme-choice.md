---
'@fluxion/core': minor
'@fluxion/dsl': minor
'@fluxion/render': patch
'@fluxion/editor': patch
---

Core's `screenThemeChoice` answers which theme record a screen draws with (screen override, applied master's, document's); render, the contrast lint rule and the theme editor share it. The lint context and `elementContrastIssues` take an optional read view, so the editor's Problems panel builds one view per pass.
