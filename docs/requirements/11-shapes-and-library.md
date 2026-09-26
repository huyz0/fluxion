# 11 — Shapes & Shape Library

Areas: `SHP` (shapes), `LIB` (library).

## SHP — Shapes

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-SHP-001 | M | R0 | A shape element references a **shape definition** (`defId`, e.g. `core:rect`) and has transform (x, y, w, h, rotation), style, text, and optional semantic data. | Rendered bounds match transform; rotation about center. |
| FR-SHP-002 | M | R1 | Built-in basic shapes: rectangle, rounded rect, ellipse, triangle, diamond, parallelogram, trapezoid, hexagon, octagon, star, arrow (block), callout, cloud, cylinder, document, note, line, polyline, freehand path, text box, image frame. | Each renders in editor & player; visual snapshot per shape. |
| FR-SHP-003 | M | R1 | Shape definitions are **parametric**: named numeric/enum params (e.g. corner radius, star points, arrow head ratio) with ranges, editable by handles and inspector. | Dragging a param handle updates geometry and is undoable. |
| FR-SHP-004 | M | R1 | Style: fill (solid, linear/radial gradient, pattern, image, none), stroke (color, width, dash, cap, join, align), opacity, corner radius, shadow, blur, glow. All style values can reference theme tokens. | Changing theme updates token-bound styles. |
| FR-SHP-005 | M | R1 | Every shape has a well-defined outline path used for hit-testing, connector perimeter projection, and morphing. | Hit-test and perimeter point tests per built-in shape. |
| FR-SHP-006 | M | R1 | Shape text: rich text inside shape with padding, alignment (h/v), auto-fit modes (none, shrink text, grow shape), overflow handling. | Grow-shape expands height to text; shrink keeps bounds. |
| FR-SHP-007 | S | R3 | Shapes may define **text regions** (multiple) and **icon slots** (e.g. card with title, body, icon). | Card shape renders 3 editable regions. |
| FR-SHP-008 | M | R3 | Lock options: position, size, rotation, aspect ratio, selection. | Locked shape cannot be moved by drag or nudge. |
| FR-SHP-009 | S | R3 | Flip horizontal/vertical. | Flip mirrors geometry and anchors. |
| FR-SHP-010 | S | R3 | Boolean path ops on vector shapes (union, subtract, intersect, exclude) producing a path shape. | Ops produce expected path on fixtures. |
| FR-SHP-011 | S | R3 | Path editing: edit vertices/bezier handles of path shapes. | Vertex drag updates path, undoable. |
| FR-SHP-012 | M | R1 | Image shapes: crop, fit (contain/cover/fill), mask with any shape outline. | Mask with ellipse clips image. |
| FR-SHP-013 | M | R6 | **Component shapes**: shape rendered by a registered React component (see `19-extensibility`). | See FR-CMP-*. |
| FR-SHP-014 | S | R3 | Tables as a shape (rows/cols, merged cells, theme styles). | Table editing: add row/col, merge, resize. |
| FR-SHP-015 | S | R6 | Built-in data chart component (bar, line, pie, area) with data in semantic props. | Chart updates on data edit; themed. |
| FR-SHP-016 | C | R6 | Embeds: code block (syntax highlighted), math (KaTeX), iframe/web embed (sandboxed, off in offline mode), QR code. | Each renders; iframe sandboxed. |

## LIB — Shape library

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-LIB-001 | M | R1 | Library panel listing shape definitions grouped by pack & category, with preview thumbnails and search. | Search "database" finds cylinder & DB icons in < 100 ms over 10k entries. |
| FR-LIB-002 | M | R1 | Drag & drop from library onto canvas (and click-to-insert at viewport center). | Dropped shape appears at drop point with default size & theme style. |
| FR-LIB-003 | M | R3 | Shape definitions are declarative JSON: outline (SVG path template with param expressions or geometry function id), anchors, text regions, handles, default size & style, keywords, category, license. | Pack JSON validates against schema; renders. |
| FR-LIB-004 | M | R3 | **Import SVG** as shape definition (single file or batch folder/zip), auto-deriving outline & default anchors; optional colorization mapping to theme tokens. | Importing 50 SVGs creates 50 usable shapes with 4+ anchors each. |
| FR-LIB-005 | S | R3 | **Import icon sets** in Iconify JSON format (e.g. Lucide, Material Symbols, Tabler, cloud-provider icons). | Importing an Iconify collection registers all icons, searchable. |
| FR-LIB-006 | S | R3 | **Import draw.io libraries** (`.xml` stencil / mxlibrary) best-effort. | Common draw.io library imports ≥ 90 % shapes. |
| FR-LIB-007 | M | R3 | First-party packs: `basic`, `flowchart`, `arrows`, `callouts`, `infographic`, `uml`, `bpmn-lite`, `network`, `cloud-architecture (generic)`, `icons (Lucide subset)`, `devices`, `people`. | All packs pass visual snapshot tests. |
| FR-LIB-008 | S | R3 | "My shapes": save selection (shape/group, including styling) as a reusable custom shape in a local pack; export/import pack file. | Saved custom group reusable across docs. |
| FR-LIB-009 | M | R3 | Lazy loading of pack contents: only index metadata loaded upfront; geometry fetched on use; only **used** definitions embedded in saved file. | A doc using 3 icons from a 5k-icon pack embeds only 3 definitions. |
| FR-LIB-010 | S | R6 | Remote pack registries (URL to pack index) with version pinning and integrity hashes. | Adding a registry URL lists its packs; install pins version+hash. |
| FR-LIB-011 | S | R3 | Replace shape: swap a shape's definition keeping text, style tokens, connections (anchor mapping by name/nearest). | Replacing rect→ellipse keeps all connectors attached. |
