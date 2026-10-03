---
'@fluxion/editor': minor
'@fluxion/studio': minor
---

The font picker (FR-THM-008): a Fonts button in the editor toolbar opens a dialog over the document's fonts, the bundled families with previews, the Google Fonts catalog and a file upload; the family chosen is applied to the selection in one undo step (`applyFontFamily`). `EditorRoot` takes `fonts` (`FontSources`); the studio supplies the bundled, Google and upload sources.
