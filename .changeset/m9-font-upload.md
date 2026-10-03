---
'@fluxion/theme': minor
'@fluxion/render': minor
'@fluxion/editor': minor
---

Font uploads (FR-THM-008, ADR-0022): `readFontFile` recognises WOFF2, TrueType and OpenType by their first bytes and reads family, weight and style from the tables (a collection, WOFF 1, an oversized or corrupt file is refused); `recordFaceMetrics` records ADR-0148 metrics in the page; `addFont` adds a font to the document as an `asset` carrying them.
