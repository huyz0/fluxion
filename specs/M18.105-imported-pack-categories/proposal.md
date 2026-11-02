# Imported library packs saved with their category names (M18.105)

FR-LIB-005 (Iconify), FR-LIB-006 (draw.io), FR-LIB-009 (only used definitions saved, lazily loaded) and NFR-LIC-003 (credits
kept). M18.101 r2 F1–F2 left two gaps. M18.105 named both, and its row turned out to be three changes:

1. **Only SVG imports reach the save.** The studio has an Import SVG… dialog, and its pack source joins the save
   (`apps/studio/src/library-import.ts`). The Iconify and draw.io importers (`importIconifyLibrary`, `importDrawioLibrary`)
   register shapes but build no pack, and nothing in the studio offers them. A document that uses an imported Iconify or
   draw.io shape cannot save it portably.
2. **Category display names are lost.** The shared encoder (ADR-0196) slugs every category ("Arrows & Pointers" becomes
   `arrows-pointers`). A pack index records only `{ path, sha256 }` per slug. The 1.0 and 1.1 schemas are strict, so a name
   cannot be added without a format version.
3. **The panel shows slugs.** `entryOf` and `entriesOfIndex` label a category by its slug, both live and after reopen.

WHEN a Studio user imports an Iconify collection or a draw.io library from the library panel and saves a document that uses
one of its shapes THE SYSTEM SHALL save that pack's used definitions and credits portably and reopen them drawn and credited
offline. The category names the source gave (Iconify `categories` keys, SVG folder names, draw.io library title) SHALL show in
the library panel before and after the reopen.

Rights are declared, never inferred (ADR-0050, ADR-0206). Iconify uses the collection's own declared SPDX licence, and a
collection without one is not saved. draw.io uses the rights the user declares in the same one-credit form as Import SVG….

Scope:
- the studio Import Iconify… and Import draw.io… entries, their packs and their save (M18.210);
- the pack format 1.2 with optional category display names (M18.211, ADR-0210);
- the panel's category labels (M18.212).

Not in scope:
- category renaming by the user;
- localisation of names;
- new import formats;
- partial imports, as M18.17 rules.
