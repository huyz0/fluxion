---
'@fluxion/schema': minor
'@fluxion/render': patch
'@fluxion/format': patch
---

`safeLinkUrl` moves to `@fluxion/schema` (`@fluxion/format` re-exports it), and the schema's link check and the rich-text views use it: a link with user information, markup characters or spaces is an error in a document and is drawn as text, as it is for a pasted or imported link (NFR-SEC-001).
