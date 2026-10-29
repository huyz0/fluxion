# SVG pack import (M18.16)

FR-LIB-004: a user turns a folder or ZIP of SVGs into usable shapes. M18.79 (pure batch), M18.80
(production witness) and M18.81 (fonts in packs) are done; nothing joins them into a host
transaction yet, and the M18 completion leg still names an editor wrapper test (cp9 F3).

WHEN `fluxion pack-import` reads the 50-SVG corpus (`specs/import/corpus/svg/`) as a folder or a
ZIP, with each member credited to its declared rights (`--credits`), THE SYSTEM SHALL write one pack
directory with 50 definitions, each with at least 4 anchors, that checks clean through the artwork
loader, the same bytes either way, with every credit scoped to exactly its members. IF a member is not a
regular SVG that converts, a name escapes the input, an entry or size cap is passed (a ZIP file's
own size checked before reading), a member's name gives no valid id, two members share an id, a
member is credited by no or two credits, the declared license is not permitted, or `-o` exists THEN THE SYSTEM SHALL exit 1
within 10 s and write nothing.

Scope: the command (ADR-0206), its folder reader and atomic writer, its `--json` schema, the
corpus/bounds suite, rebinding the completion leg, and M18.81 r2 F1 (face families keyed
case-insensitively, so "Inter" and "inter" on one font share a face). Not in scope: the library UI
(M18.17), other font profiles (M18.48/39/40), MCP.
