---
'@fluxion/editor': minor
'@fluxion/studio': patch
---

The left panel has a Source tab (FR-EDT-022): the shown screen's FluxScript in CodeMirror, loaded as a lazy chunk. After 300 ms without a keystroke the text is compiled into the open document and applied as one undo step; a text with errors applies nothing and shows its diagnostics in the gutter and in a list. `EditorRoot` takes `sourceRegistries` (the core registries the text is compiled against).
