# 21 — Import, Export & Publish

Areas: `IMP` (import), `EXP` (export), `SITE` (static info site).

## IMP — Import

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-IMP-001 | M | R2 | Mermaid → document (see FR-DSL-007). | Fixtures. |
| FR-IMP-002 | M | R2 | Markdown outline → deck (headings → screens, bullets → content with layout templates). | Fixture deck renders. |
| FR-IMP-003 | S | R7 | PPTX import (best effort: shapes, text, images, basic connectors, theme colors/fonts, notes). | ≥ 80 % elements of fixture decks imported. |
| FR-IMP-004 | S | R7 | draw.io (`.drawio`) and Excalidraw (`.excalidraw`) import. | Fixtures. |
| FR-IMP-005 | C | R7 | Import from D2 / Graphviz DOT. | Fixtures. |

## EXP — Export

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-EXP-001 | M | R1 | Self-contained HTML (the `*.flux.html` file itself). | FR-FIL-002. |
| FR-EXP-002 | M | R7 | PDF export: one page per screen (or per build step option), vector where possible, notes pages option. | PDF text is selectable; visual diff vs render ≤ 1 %. |
| FR-EXP-003 | M | R7 | PNG/JPEG/WebP export of screen/selection at scale (1–4×) with transparent background option. | Output dimensions correct. |
| FR-EXP-004 | M | R3 | SVG export of screen/selection (fonts embedded or outlined option). | Opens in Inkscape/browser identically. |
| FR-EXP-005 | S | R7 | PPTX export: shapes as native shapes where mappable, connectors as connectors, text editable, others as SVG/PNG images; notes. | Fixture opens in PowerPoint/LibreOffice. |
| FR-EXP-006 | S | R7 | Video/GIF export of a screen or whole presentation with animations (headless recording, CLI). | MP4 of fixture with expected duration. |
| FR-EXP-007 | S | R2 | Export Mermaid (lossy) for diagram screens. | Fixture. |
| FR-EXP-008 | M | R2 | Export DSL (decompile) and JSON. | See FR-DSL-008, FR-FIL-005. |

## SITE — Static info site

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-SITE-001 | M | R7 | Publish a document as a **static info site**: each screen or section → page; navigation (sidebar/top nav from sections), scroll mode for long pages, deep links, search (client-side index). | `fluxion site build` outputs deployable folder; Lighthouse ≥ 90 perf/a11y. |
| FR-SITE-002 | M | R7 | Site output is static files (HTML per page with pre-rendered SVG/HTML for SEO and no-JS readability + hydration for animations/interactions). | Page readable with JS disabled. |
| FR-SITE-003 | S | R7 | Site themes/templates (docs, landing, portfolio, report) and SEO meta (title, description, OpenGraph image auto-rendered). | OG image generated. |
| FR-SITE-004 | S | R7 | Single-file site variant (all pages in one HTML with hash routing). | Opens offline. |
| FR-SITE-005 | C | R8 | Multi-document site (site manifest linking several docs). | Cross-doc links work. |
