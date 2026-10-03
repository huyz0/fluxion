---
'@fluxion/core': minor
---

Commands `document.setTheme`, `screen.setThemeOverride` and `document.updateMeta` (FR-THM-004, FR-DOC-006): a chosen theme is copied into the document as a `theme-<slug>` record and the document or a screen points at it, each in one undo step; `themeRecordId` is exported.
