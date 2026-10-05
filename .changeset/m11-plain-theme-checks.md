---
'@fluxion/schema': minor
'@fluxion/theme': minor
'@fluxion/render': patch
---

A theme and its tokens can be checked without Zod (FR-THM-001, NFR-SEC-001): `isCssColor` (schema) is the check `colorSchema` makes, `themeOf` (theme) reads a theme exactly as `themeSchema` does, and `isValidToken` is a plain check too. A screen's theme is read with `themeOf`, so a reader that ships no validator keeps other CSS out of a style all the same. `tokenEntries` no longer overflows the stack on a malformed theme whose group holds a bare value.
