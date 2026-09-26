# 14 — Theme, Text & Media

Areas: `THM` (theme, palette, fonts), `TXT` (text).

## THM — Theming

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-THM-001 | M | R1 | A theme is a set of **design tokens**: color palette (semantic roles: background, surface, text, muted, primary, secondary, accent-1..6, success, warning, danger, info, connector), typography (heading/body/mono families, scale, weights, line-heights), spacing scale, radii, stroke widths, shadows/effects, motion (durations, easings). | Theme JSON validates; tokens resolved in render. |
| FR-THM-002 | M | R1 | Element styles reference tokens (`{color.primary}`), literal values, or token-derived values (e.g. `{color.primary}` lightened 20 % in OKLCH). | Changing primary recolors all referencing elements. |
| FR-THM-003 | M | R1 | Built-in themes: ≥ 8 (light, dark, corporate, vibrant, pastel, high-contrast, blueprint, chalkboard). | Visual snapshot of a reference doc per theme. |
| FR-THM-004 | M | R1 | Switch document theme in one action (undoable); per-screen theme override. | Switch updates all screens; override respected. |
| FR-THM-005 | S | R3 | **Palette generator**: from 1–3 seed colors or an image, generate an accessible palette (OKLCH-based) with contrast checks; lock/shuffle roles. | Generated text/background pairs meet WCAG AA 4.5:1. |
| FR-THM-006 | M | R3 | Per-shape-kind **default styles** in theme (e.g. `flowchart.decision` fill = accent-2), with variants (`primary`, `subtle`, `outline`, `emphasis`) selectable by name. | AI can set `variant: "emphasis"` and gets themed style. |
| FR-THM-007 | S | R3 | Theme editor UI with live preview; save/import/export theme files; theme packs. | Exported theme re-imports equal. |
| FR-THM-008 | M | R1 | Fonts: pick from bundled open fonts + Google Fonts catalog (fetched & embedded on save) + local upload (WOFF2/TTF/OTF). | Offline file renders with embedded font. |
| FR-THM-009 | S | R3 | Import tokens from W3C Design Tokens (DTCG) JSON; export theme as DTCG and CSS variables. | Round-trip DTCG fixture. |
| FR-THM-010 | S | R7 | Light/dark theme pairs; viewer's `prefers-color-scheme` may select variant when enabled. | Dark OS setting renders dark variant. |
| FR-THM-011 | C | R6 | Theme-able effect presets (glassmorphism, neumorphism, hand-drawn/sketch rendering style like rough.js). | Sketch style renders shapes with rough strokes deterministically (seeded). |

## TXT — Text

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-TXT-001 | M | R1 | Rich text: bold, italic, underline, strike, color, highlight, size, font, links, lists (bullet/number, nesting), headings, inline code, alignment, line/paragraph spacing. | Editing and rendering parity (snapshot in edit vs present). |
| FR-TXT-002 | M | R1 | Text measurement consistent between editor, player, layout, and exporters (same font metrics). | Layout-measured size equals rendered size ±1 px. |
| FR-TXT-003 | M | R1 | Inline text editing on canvas (double-click / Enter), with keyboard shortcuts. | E2E. |
| FR-TXT-004 | S | R1 | Markdown shortcuts while typing (`# `, `- `, `**b**`). | E2E. |
| FR-TXT-005 | S | R4 | Text animations: typewriter, per-word/per-letter reveal, counter (number count-up). | Snapshot at time t. |
| FR-TXT-006 | M | R8 | Unicode, RTL, CJK, emoji support; language tag per doc/element; hyphenation option. | RTL fixture renders right-aligned, correct shaping. |
| FR-TXT-007 | S | R4 | Variables and fields in text (`{{page}}`, `{{title}}`, `{{vars.x}}`). | Page number field updates. |
| FR-TXT-008 | C | R6 | Spell check (browser native) and find & replace across document. | Replace-all changes all screens. |
