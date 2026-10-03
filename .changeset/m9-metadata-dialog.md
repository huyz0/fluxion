---
'@fluxion/editor': minor
'@fluxion/core': patch
---

The document details dialog (FR-DOC-006): a Details button in the editor toolbar opens title, description, language, authors, tags and custom fields over `document.updateMeta`, one undo step, `modified` from the browser's clock. `document.updateMeta` names the language field `lang`, as the document record does.
