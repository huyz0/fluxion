---
'@fluxion/editor': minor
---

The theme editor seeds its palette from a picked image (decoded at most 256 px on the longest side), exports the edited theme as `<slug>.tokens.json` and, separately, as CSS variables, and imports a Fluxion or foreign DTCG file as a new theme record in one undo step, listing the import's warnings. `ThemeEditorProps` gains an optional `download`.
