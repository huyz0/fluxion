---
'@fluxion/studio': minor
'@fluxion/render': minor
---

A file the studio opens brings its fonts: each font asset is loaded as a face from the file's own bytes and its recorded metrics are registered, so text is drawn and measured in the font the author used; closing the document takes them out again (FR-THM-008, FR-FIL-006). `registerFontMetrics` keeps its registrations in layers: a face registered again replaces the earlier record while it is in force, and releasing it gives the earlier one back.
