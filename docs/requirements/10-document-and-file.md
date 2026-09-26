# 10 — Document Model, File & Persistence

Areas: `DOC` (document model), `SCR` (screens), `FIL` (file & persistence), `AST` (assets).

## DOC — Document model

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-DOC-001 | M | R0 | The document is a versioned, JSON-serializable tree of normalized records: `document`, `screen`, `element` (shape, connector, group, text, image, component), `asset`, `theme`, `plugin-ref`. | Round-trip `parse(serialize(doc))` deep-equals `doc` for all fixtures. |
| FR-DOC-002 | M | R0 | Every record has a stable unique ID (URL-safe, ≥ 64 bits entropy) and a `type` discriminator. | Property test: 1e6 generated IDs have no collision; IDs survive save/load/copy within doc. |
| FR-DOC-003 | M | R0 | The document carries `schemaVersion` (semver); loading an older version runs ordered migrations to current. | Fixture of every released schema version migrates and validates. |
| FR-DOC-004 | M | R0 | Runtime validation reports all errors with JSON-pointer paths and human/AI-readable messages. | Invalid fixtures produce expected error lists (snapshot). |
| FR-DOC-005 | M | R0 | Unknown fields from newer versions or unknown plugin types are preserved (not dropped) and rendered as a placeholder. | Loading a doc with unknown element type shows a placeholder and saving preserves the data byte-equivalent. |
| FR-DOC-006 | M | R1 | Document metadata: title, description, authors, language, created/modified timestamps, tags, custom key-value. | Metadata editable in UI and round-trips. |
| FR-DOC-007 | S | R2 | Element-level `semantic` data: arbitrary typed data (label, role, data fields) independent of visual style, usable by layouts, AI, and components. | Layout and components can read `semantic` fields; preserved on style change. |
| FR-DOC-008 | S | R5 | Document-level variables (typed: string, number, boolean, color) with defaults, usable in bindings and interactions. | Variable change re-renders bound properties. |
| FR-DOC-009 | C | R6 | Data bindings: element properties may bind to expressions over variables/semantic data (safe, sandboxed expression language, no `eval`). | Binding `fill = vars.ok ? theme.success : theme.danger` evaluates correctly; malicious input cannot execute code. |
| FR-DOC-010 | M | R0 | Model is CRDT-friendly: records keyed by ID, ordering by fractional indices, no positional arrays for z-order/screens. | Reordering produces changes limited to the moved records. |

## SCR — Screens

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-SCR-001 | M | R0 | A document contains an ordered list of screens; each screen has logical size (default 1920×1080), background (color/gradient/image/theme token), and elements. | Screen order persists; size and background render. |
| FR-SCR-002 | M | R1 | Add, duplicate, delete, reorder (drag), rename, hide/skip screens. | Operations undoable; hidden screens skipped in present mode. |
| FR-SCR-003 | M | R1 | Screen presets: 16:9, 4:3, 16:10, 9:16 (portrait), A4, custom; plus "infinite canvas" screen type with a defined present viewport. | Each preset renders at correct aspect ratio. |
| FR-SCR-004 | S | R1 | Screen sections/chapters to group screens (for navigation & site pages). | Sections shown in navigator and site nav. |
| FR-SCR-005 | S | R3 | Master/layout screens: reusable backgrounds, placeholders and elements inherited by screens. | Changing master updates all dependent screens. |
| FR-SCR-006 | M | R1 | Speaker notes per screen (rich text). | Notes visible in speaker view and editor notes panel. |
| FR-SCR-007 | S | R5 | Screen states: a screen may define named states (e.g. `overview`, `detail`) each overriding element properties; transitions between states animate. | Switching state animates changed properties. |
| FR-SCR-008 | S | R5 | Sub-screens (nested canvas) attachable to a shape for drill-down zoom. | Zooming into the shape reveals the sub-screen content seamlessly. |

## FIL — File & persistence

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-FIL-001 | M | R1 | Save the whole document (content, theme, assets, used plugin bundles) into **one file**. | Saved file opens on a machine with no network and renders identically. |
| FR-FIL-002 | M | R1 | The single file is a **self-contained HTML** (`*.flux.html`) that presents when opened in a browser (embedded player) and can be opened for editing by the studio. | Double-clicking the file opens a working presentation; dropping it into the studio loads it for editing. |
| FR-FIL-003 | M | R1 | A compact **data-only** variant (`*.flux`) exists — compressed container without player — for storage, AI pipelines and version control. | `*.flux` ↔ `*.flux.html` lossless conversion. |
| FR-FIL-004 | M | R1 | Payload is compressed; assets are content-addressed (hash) and deduplicated. | Duplicating an image 10× increases file size by < 1 kB. |
| FR-FIL-005 | S | R2 | An uncompressed, pretty-printed JSON variant (`*.flux.json`) for diffs and git. | Stable key order; deterministic output for identical docs (byte-identical). |
| FR-FIL-006 | M | R1 | Open files via picker, drag-and-drop, URL (`?src=`), and paste; save via File System Access API with download fallback. | Works in Chromium (FS Access) and Firefox/Safari (download fallback). |
| FR-FIL-007 | M | R1 | Autosave to local browser storage (IndexedDB/OPFS) with crash recovery and version snapshots (last N). | Killing the tab and reopening offers recovery of unsaved work. |
| FR-FIL-008 | S | R1 | Recent files list and local document library. | Library lists docs with thumbnails. |
| FR-FIL-009 | M | R1 | Loading validates and migrates; a corrupt payload shows a recoverable error with partial salvage where possible. | Truncated file loads valid screens and reports the rest. |
| FR-FIL-010 | S | R6 | Optional file-level integrity: payload hash and optional signature of embedded plugin code. | Tampered plugin code is detected and blocked (see NFR-SEC). |
| FR-FIL-011 | C | R8 | Password-protected (encrypted) export using WebCrypto (AES-GCM, PBKDF2/Argon2). | Encrypted file opens only with the correct password. |

## AST — Assets

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-AST-001 | M | R1 | Import images (PNG, JPEG, WebP, AVIF, GIF, SVG) by drop, paste, picker. | Imported asset renders and is embedded on save. |
| FR-AST-002 | S | R1 | Optimize on import: downscale above configurable max size, re-encode to WebP/AVIF when smaller, sanitize & minify SVG. | 4000px JPEG imported at default settings is ≤ 2560px WebP. |
| FR-AST-003 | S | R3 | Fonts as assets: embed only used fonts, subset to used glyphs on save (option). | Doc using one Google font weight embeds ≤ 60 kB for Latin text. |
| FR-AST-004 | S | R4 | Rich media assets: Lottie/dotLottie, video (MP4/WebM, size-warned), audio. | Lottie asset plays in player. |
| FR-AST-005 | M | R1 | Asset manager panel: list, replace, remove unused, show size contribution. | "Remove unused" deletes unreferenced assets. |
| FR-AST-006 | S | R2 | External asset references (URL) allowed with "embed on save" option. | Toggling embed makes file offline-safe. |
