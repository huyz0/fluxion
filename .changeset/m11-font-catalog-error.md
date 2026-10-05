---
'@fluxion/studio': patch
---

A Google Fonts catalog that cannot be fetched is an error the font picker shows (and asks for again next time), not an empty list; the font picker spec waits for the catalog before it searches (FR-THM-008).
