# 04 — File Format, AI Generation & Theming

> Status: Research input · Date: 2026-09-26 · Scope: portable single-file format, AI authoring pipeline, theming token model
> Vocabulary follows `00-product-analysis.md` (Document, Screen, Element, Shape, Connector, Rider, Layout, Theme, Timeline, Interaction, Plugin/Pack, Player).

---

## 0. TL;DR

- **One canonical model, two wrappers.** The canonical document is a JSON record store (`document.json`). It is wrapped either as a **`.flux` file** (a ZIP container: manifest + document + content-addressed binary assets + plugin bundles) for editing/exchange, or as a **`.flux.html` file** (a self-contained HTML Player with the same package embedded) for "double-click to present". The editor opens both; they round-trip losslessly.
- **The AI never writes the canonical JSON directly for big jobs.** It writes **FluxScript** (a compact YAML-shaped DSL with ids, semantic intents, layout intents, theme token references, and no coordinates) or calls MCP tools that apply small typed operations. A compiler validates, auto-lays-out, and emits canonical records; errors come back as repair-ready messages.
- **Schema = TypeBox/Zod-style runtime schemas → JSON Schema** (for LLM structured outputs, MCP tool schemas and validation) + **per-record-type versioned migrations** (tldraw-style) + **stable nanoid ids** in a **normalized record map** (CRDT-ready).
- **Plugins** ship as pinned, hashed ESM bundles inside the package; untrusted plugin code runs in a **sandboxed iframe** (opaque origin) by default; only trusted/first-party plugins run in the main realm.
- **Theming** uses the **W3C DTCG 2025.10 stable format** for tokens, OKLCH-based palette generation (culori), WCAG 2.2 contrast as the gate (APCA advisory only), Fontsource/self-hosted subset WOFF2 fonts embedded in the file, and CSS custom properties for live switching.

---

## A. Portable single-file formats

### A.1 Precedents

| Product / format | Container | What's inside | Embedding tricks | Lessons for Fluxion |
|---|---|---|---|---|
| **Excalidraw `.excalidraw`** | Plain JSON (`type`, `version`, `source`, `elements[]`, `appState`, `files{}`) | Elements array; images as base64 data URLs in `files` keyed by file id | **PNG export** stores scene in a `tEXt`/`iTXt` chunk keyed `excalidraw`; **SVG export** puts it in `<metadata>` between `<!-- payload-type:application/vnd.excalidraw+json -->…<!-- payload-start -->…<!-- payload-end -->` markers, zlib (pako)-compressed + base64 | Human-readable JSON is great for diffing and AI, but base64 images bloat it. "Editable image" export is a delightful feature worth copying. `restore()` normalizes/repairs any old or partial input — a robust "accept anything, fix it" loader. |
| **tldraw `.tldr`** | JSON serialization of a `StoreSnapshot` | `store`: flat map of records by id (`shape:…`, `page:…`, `asset:…`); `schema`: per-record-type versions | Assets can be inline or referenced | **Records + schema-versions + migrations** is the best-in-class model: loading an old file runs store-level, then record-level, then subtype-level migrations (each with `id`, `up`, `down`). Custom shapes declare their own migrations. |
| **draw.io `.drawio`** | XML `<mxfile><diagram>` — each page either plain `<mxGraphModel>` or **deflate-raw + base64** | mxCell graph (vertex/edge), style strings `key=value;` | Diagram XML embedded in **PNG `zTXt`** chunk and in SVG `content` attribute; "HTML export" bundles the viewer + XML | draw.io's own AI guidance says: *generate uncompressed XML; compression costs tokens and blocks validation*; use layout presets (`verticalFlow`, `horizontalTree`, `organic`…) instead of coordinates; ships an MCP server. Confirms our "compress only at the container level, never inside the model" rule. |
| **Figma `.fig`** | Proprietary binary (Kiwi schema-encoded, compressed) inside a zip-like wrapper with thumbnail + images | Node tree | — | Binary schema encoding is very compact but opaque; unsuited to an AI-first, open format. |
| **Penpot** | `.penpot` export = ZIP (v2 format moved to a zip of JSON files + binary media); SVG/CSS-native model | Files, pages, components, media | — | Open zip-of-JSON layout; native DTCG tokens support. |
| **OOXML `.pptx`** | ZIP (Open Packaging Conventions): `[Content_Types].xml`, `_rels/`, `ppt/slides/slideN.xml`, `ppt/media/*` | Split per slide; relationships file wires parts | Thumbnails in `docProps/` | Proven: zip container, per-part files, media stored once and referenced; deflate per entry so already-compressed media is stored raw. Over-engineered relationships layer — a simple manifest suffices. |
| **Keynote `.key`** | Bundle/zip of IWA (Snappy-compressed protobuf) + media + preview images | — | — | Preview images in the package make OS-level thumbnails possible (Quick Look). Consider a `preview.webp` entry. |
| **TiddlyWiki** | **Single HTML file** = runtime + data; data lives in `<script class="tiddlywiki-tiddler-store" type="application/json">[…]</script>` (since 5.2.0) | Tiddlers as JSON array | "Saving" rewrites the whole HTML (download, FSA API, or saver plugins) | Canonical precedent for "the document *is* the app". JSON-in-script store makes external tools able to inject data by prepending a script tag. The downside: every save re-emits the whole runtime. |
| **SingleFile / SingleFileZ** | HTML, or **self-extracting HTML/ZIP polyglot**: ZIP bytes stored inside an HTML comment; a small bootstrap script reads the file, unzips, and renders | Page + resources | "Universal" variant opens in any browser with no extension and is ≥30% smaller than base64-inlined HTML | Proves a polyglot HTML+ZIP is viable and meaningfully smaller than base64. Caveat: reading its own bytes from `file://` needs tricks (the universal variant embeds data so the page does not need to fetch itself). |
| **Observable / marimo / Jupyter** | Jupyter `.ipynb` = JSON with base64 outputs; marimo exports **self-contained HTML** with notebook code + outputs embedded and a WASM runtime option | Cells, outputs | marimo embeds the source code so the HTML can be re-opened as an editable notebook | Validates "export HTML that is also re-importable": keep the canonical source inside the HTML export. Jupyter shows the pain of base64 outputs in JSON (large diffs, big files). |
| **"HTML as a document format"** (e.g. SingleFile, Quarto/revealjs `embed-resources`, "HTML is the new PDF" essays) | HTML with inlined CSS/JS/fonts/images | — | — | Every browser is a viewer; no install. Costs: base64 overhead, big runtime per file, security posture of running script from a file. |

**Takeaways**
1. Every successful editor keeps an **uncompressed, human/AI-readable canonical model** and applies compression only at the container level.
2. **Records in a flat id map + per-type schema versions** (tldraw) beats a nested tree for migrations, diffing, CRDTs and partial AI edits.
3. Binary assets belong **outside** the JSON (zip entries), referenced by id/hash.
4. "Editable exports" (PNG/SVG/HTML that carry the source) are high-value, cheap features.

### A.2 Container options

| Option | Size | Readable / diffable | Browser-openable as-is | Binary assets | Streaming/partial read | Tooling | Verdict |
|---|---|---|---|---|---|---|---|
| Pure JSON (assets base64) | Worst (+33% on binaries, no compression) | Yes | No (needs app) | Poor | No | Trivial | Only for tiny docs / clipboard / AI I/O |
| JSON + gzip/deflate (`.json.gz`) | Good for text (JSON typically 5–15× smaller) | No (until unzipped) | No | Still base64 | No | `CompressionStream('gzip')` native everywhere | OK, but zip dominates it |
| JSON + brotli | ~10–20% smaller than gzip on text | No | No | Still base64 | No | Native `CompressionStream` brotli is **not yet universal** (Chromium/Safari progress; Firefox pending) → needs a wasm lib (brotli-wasm ≈ 400–700 KB) | Not worth it for a user file |
| **ZIP (fflate / zip.js)** with `manifest.json` + `document.json` + `assets/*` + `plugins/*` | Good: deflate per entry; media stored (method 0) with **no base64 overhead** | Unzip → readable JSON | No (needs app) — unless polyglot | Excellent | Yes (central directory → read one entry) | Universal (OS, CLI, every language); fflate ≈ 8 KB gz, fast, sync+async | **Recommended primary container** |
| CBOR / MessagePack | 10–30% smaller than JSON before compression; gap mostly vanishes after deflate | No | No | Native bytes | Some | Libraries everywhere, but not AI-friendly | Not for the file; maybe for sync wire format |
| **Single HTML**: `<script type="application/json">` payload + inlined minified Player | Player runtime (~100–250 KB min, ~35–80 KB gz) + payload; binaries base64 (+33%) unless compressed-then-base64 | Payload is readable if stored plain | **Yes — double-click to present** | Base64 (or base64 of a zip) | No | Only browsers | **Recommended secondary wrapper (export/share)** |
| HTML/ZIP polyglot (SingleFile-style) | Best HTML size (no base64) | Unzip-able | Yes (with bootstrap tricks) | Excellent | — | Fragile (byte-exact offsets, comment-safety of binary, some mail/AV scanners flag polyglots) | Research spike later; not v1 |

**The single-HTML trade-off in detail**

| Concern | `.flux` (zip) | `.flux.html` (self-contained) |
|---|---|---|
| Opens without Fluxion installed | No (needs web app / PWA / desktop) | **Yes**, any modern browser, offline |
| Size overhead | ~0 beyond content | + Player runtime (≈40–80 KB gz-equivalent) + base64 (+33%) on assets unless we use the "compressed-bundle" trick below |
| Re-editable | Yes | Yes — the editor extracts the embedded package (marimo/TiddlyWiki pattern) |
| Can present with plugins | Yes | Yes if plugin bundles are embedded |
| Security posture | Data only; code runs only in our app under our CSP | The file *is* executable HTML; email gateways and corporate AV may block `.html` attachments; must avoid anything that looks like phishing |
| Save-in-place from the file itself | N/A | Possible via FSA API on Chromium, else "download a new copy" (TiddlyWiki problem) |
| Version skew | App always uses latest Player/migrations | Frozen Player version; fine for viewing; editor migrates on import |

**Compressed-bundle trick for HTML.** Browsers can't gunzip an HTML file opened from disk, but a ~1–2 KB inline bootstrap can: store `base64(zip or gzip(player.js + document + assets))` in a `<script type="application/octet-stream">`, decode with `Uint8Array.fromBase64` (or `atob` fallback), inflate with native `DecompressionStream('deflate-raw'|'gzip')` (Baseline since 2023), then `import()` the player from a Blob URL and hand it the decoded package. Net effect: base64 overhead is applied to *compressed* bytes, so a text-heavy deck ends up **smaller** than naive inlining. Cost: nothing renders until JS runs (add a `<noscript>` + static SVG fallback of screen 1). *Verify in spike:* `import(blobURL)` from a `file://` page in Chrome/Firefox/Safari (opaque origin); fallback = inline `<script type="module">` text (no Blob) for the Player, which always works.

### A.3 Asset handling

| Topic | Recommendation | Notes / tools |
|---|---|---|
| Addressing | **Content-addressed**: `assets/<sha256-hex>.<ext>` (store first 16–20 bytes hex = 32–40 chars is plenty); record in document `asset:<id>` → `{hash, mime, bytes, w, h, alt, source}` | `crypto.subtle.digest('SHA-256', buf)` (secure contexts; `file://` pages count as potentially trustworthy in Chromium — verify; fallback: small JS sha256, e.g. `@noble/hashes`) |
| Dedupe | Automatic by hash; GC unreferenced assets on save | Also dedupe identical inline SVG strings by hash |
| Raster images | Transcode on import to **WebP** (universal) or **AVIF** (Baseline 2024, best ratio but slow encode in browser); keep original only if user opts in; cap longest side (e.g. 2560 px) | `OffscreenCanvas.convertToBlob({type:'image/webp', quality:.82})`; AVIF encode via `@jsquash/avif` wasm (heavy — lazy-load) |
| SVG | Run **SVGO** (`preset-default`, keep `viewBox`, strip editor metadata, `removeScripts`, sanitize with DOMPurify SVG profile) | SVG is also a security surface (scripts, external refs) |
| Fonts | **Subset** to used glyphs (+ a safety range for the document's scripts) and embed WOFF2; keep variable axes that are used; reference by family + hash | `subset-font` / `hb-subset-wasm` (HarfBuzz wasm; supports variable-axis pinning/limiting); `glyphhanger` for CLI; Latin subset of a variable font typically 20–60 KB WOFF2 |
| Zip compression | Deflate for JSON/SVG/JS/CSS; **store** (method 0) for WebP/AVIF/WOFF2/PNG/MP4 | fflate `zip()` with per-file `level` |
| Base64 | Only in the HTML wrapper, and only over already-compressed bytes | 4/3 size factor; plus JSON string escaping is free for base64 alphabet |
| Large media (video) | Allow external URL references with `integrity` hash + poster frame; embed optional | Keeps files shareable |

### A.4 Embedding plugins / React-component shapes safely

| Mechanism | What it gives | Status (2026) | Use in Fluxion |
|---|---|---|---|
| ESM bundle stored as file in zip (`plugins/<name>@<ver>/index.js`), loaded via **Blob URL** `import()` | Real ES modules from bytes | Universal | Loader for trusted plugins |
| **Import maps** (`<script type="importmap">`) | Map bare specifiers (`react`, `@fluxion/sdk`) → host-provided modules so plugins don't bundle React | Baseline (multiple import maps + dynamic merge shipping 2025) | Plugins declare `peerDependencies` on `react`, `@fluxion/sdk`; host injects map. Singleton React is required for hooks. |
| **Sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`) → opaque origin; `srcdoc`/Blob; talk via `postMessage`/MessageChannel | Hard isolation from app DOM, storage, cookies | Universal, battle-tested (Figma plugins, Observable) | **Default for third-party/untrusted plugins.** Component shapes render inside the iframe; the host positions it; data via RPC. Shape *geometry/path* plugins can return serializable SVG path data instead of running in-frame. |
| **CSP** (`script-src 'self' blob: 'sha256-…'`, `connect-src` restricted, `object-src 'none'`) | Limits what embedded code can load/exfiltrate | Universal; meta-CSP works in `file://` HTML | Ship strict CSP in both app and `.flux.html`; plugin network access requires explicit manifest permission |
| **Trusted Types** | Blocks DOM-XSS sinks unless policy-approved | Chromium + Safari 26 + Firefox shipped 2025/26 (verify baseline) | Enforce in the app; route all HTML-from-document (rich text) through a DOMPurify policy |
| **SES / Hardened JS `Compartment`** (Endo/Agoric) | Same-realm object-capability isolation, frozen intrinsics | Production library (used by MetaMask LavaMoat) | Option for "logic-only" plugins (layout algorithms, importers) where iframe latency hurts; not for DOM/React code |
| **ShadowRealm** | Native realm isolation, `importValue` | TC39 **Stage 2.7**, not in browsers; Node removed experimental flag | Watch; don't depend on it |
| Web Worker | Off-main-thread, no DOM | Universal | Layout engines (ELK), importers, font subsetting; plugins can declare `worker` entry points |

**Version pinning & integrity.** Manifest lists each plugin `{id, version (exact semver), sha256 of bundle, sdkRange, permissions, entry points}`. Loader refuses bundles whose hash mismatches. Documents record the plugin ids+versions that created each record type (`shape:acme.gauge@2.1.0`) so migrations can be routed to the plugin. If a plugin is missing or refused, the Player renders each of its elements from a **fallback snapshot** (last-rendered static SVG/PNG stored in the file) — the document stays viewable, just not interactive for that element. This is essential for AI-generated or shared files that reference plugins the viewer has not trusted.

### A.5 Schema design

| Concern | Recommendation | Rationale / precedent |
|---|---|---|
| Shape of data | **Normalized record store**: `records: { [id]: Record }` where `Record = {id, type, ...}`; types: `document`, `screen`, `shape`, `connector`, `group`, `text`, `image`, `component`, `asset`, `timeline`, `step`, `interaction`, `theme`, `binding` | tldraw store; trivially maps to Yjs `Y.Map`/Loro `LoroMap` per record; partial updates and AI patches become per-record ops |
| Ordering | Fractional index strings (`zIndex: "a0V"`) for z-order and screen order, not arrays | Concurrent-insert safe; tldraw/Figma/Excalidraw use fractional indices |
| Parent/child | `parentId` on child (screen or group) | Tree moves are single-field updates (Loro movable tree optional later) |
| IDs | `nanoid(12)` with type prefix (`shp_V1StGXR8_Z5j`); **AI-facing ids are human slugs** (`api`, `db`) mapped by compiler; ULID only if we need time ordering | Slugs are cheap tokens & stable for re-generation; nanoid is 130 B |
| Validation | Runtime schemas in **TypeBox** (emits JSON Schema natively, fast compiled validators) — or **Zod 4** (`z.toJSONSchema()` built-in, huge ecosystem); **Valibot** if bundle size in the Player matters (tree-shakeable, ~1–2 KB used) | Need JSON Schema for LLM structured outputs & MCP; need TS types; need readable error paths for repair loops |
| LLM-facing schemas | Separate, *smaller* schemas for FluxScript and MCP ops; comply with provider strict-mode subsets (`additionalProperties:false`, all props required/nullable, limited `oneOf`) | Claude strict tool use / JSON outputs and OpenAI Structured Outputs both constrain decoding to a JSON Schema subset |
| Versioning | `formatVersion` (container), and **per record type** `schemaVersions: {"shape": 4, "shape:acme.gauge": 2, …}` | tldraw pattern; plugins own their subtypes |
| Migrations | Ordered, id'd `up` (and `down` where feasible) functions per record type; store-level migrations for structural changes; run on load; write back latest only; keep a golden-file test corpus of every released version | tldraw `StoreSchema.migrateStoreSnapshot`; Excalidraw `restore()` adds a *leniency layer* (fill defaults, drop invalid) — do both: strict migrate + lenient repair |
| Forward compat | Unknown record types / fields are **preserved** (round-trip) and rendered via fallback snapshot | Opening a newer file in an older Player must not destroy data |
| Save APIs | `showSaveFilePicker`/`showOpenFilePicker` + `FileSystemFileHandle` (Chromium only); fallback: `<input type=file>` + `<a download>` (Firefox/Safari still lack pickers in 2026); desktop wrapper (Tauri/Electron) gets native FS | browser-fs-access (GoogleChromeLabs) wraps this pattern |
| Local persistence | **Autosave** records to **IndexedDB** (per-record puts, debounced) or **OPFS** (`createSyncAccessHandle` in a worker for fast zip writes); store file handles in IDB for "reopen recent" | OPFS is supported in all engines incl. Safari 15.2+ |
| Collaboration (later) | Keep everything as flat JSON records with primitive fields; rich text as a separate text record (can become `Y.Text`/`LoroText`); no derived data persisted (layout output cached separately and recomputable) | Yjs = ecosystem default; Loro = best performance, smallest encoding, native movable tree; Automerge = best history. A normalized record store maps onto any of them. Undo/redo implemented as op-inversions on records now = compatible with CRDT undo later. |

---

## B. AI generation

### B.1 How LLMs best generate diagrams and presentations

| Approach | Examples | Pros | Cons |
|---|---|---|---|
| **Direct canonical JSON** (structured outputs) | Excalidraw-JSON prompting, draw.io XML | One step; schema-constrained decoding guarantees parseable output | Verbose (3–10× tokens vs DSL); LLMs are bad at coordinates/geometry; huge schemas degrade strict-mode quality and hit schema-size limits |
| **Text DSL → compile + auto-layout** | Mermaid, D2, PlantUML, Graphviz DOT, Eraser DiagramGPT (Eraser DSL), Excalidraw text-to-diagram (prompt → Mermaid → `mermaid-to-excalidraw`) | Very token-efficient; models have huge pretraining exposure to Mermaid/DOT/Markdown; no coordinate math; easy to diff and to regenerate one part | DSL errors need a parser with good messages; limited expressiveness unless extensible |
| **Markdown slide DSLs** | Slidev, Marp, reveal.js Markdown, Quarto | LLMs write Markdown natively; `---` separators; frontmatter for config | Weak for diagrams and spatial layout; styling via CSS/classes |
| **Outline-first, then fill** | Gamma (outline of cards → user edits → full generation with layout/imagery chosen by the system), Tome, Beautiful.ai "smart templates" | Human checkpoint where it's cheapest; the system picks layouts from a library so output always looks designed | Requires a strong layout/template library |
| **Semantic intent + layout engine** | Napkin (text → visual type selection), Beautiful.ai smart slides, draw.io `layout` presets, research systems (DiagrammerGPT: plan → layout → render) | LLM chooses *what* (entities, relations, emphasis, visual archetype); engines choose *where* | Engine quality becomes the product |
| **Tool/function calling & MCP** | draw.io MCP server, tldraw agent starter kit, Figma MCP | Small incremental edits, conversational refinement, the model can read back state; strict tool schemas guarantee valid args | Chatty for whole-document generation; needs good read tools (summaries, not raw JSON) |

**Evidence & practice points**
- Token efficiency: edge lists / YAML-like encodings use a fraction of the tokens of verbose JSON(-LD) for the same graph; very terse novel formats (e.g. TOON) save tokens but lose accuracy vs formats models know well. ⇒ **Prefer a format that looks like YAML/Mermaid (familiar) over a novel compact syntax.**
- draw.io's official AI guidance: plain uncompressed XML, unique ids, no comments, use layout presets rather than coordinates, validate against schema.
- Structured outputs: Claude (strict tool use / JSON outputs, `additionalProperties:false`, grammar-constrained sampling) and OpenAI Structured Outputs guarantee schema-valid JSON; they do **not** guarantee semantic validity (dangling connector ids, overlapping screens) → a validation-repair loop is still required.
- **Validation-repair loop:** parse → schema validate → semantic validate (refs, cycles, plugin availability, token names, text overflow estimate) → return compact error list with paths + suggestions (`screen "arch": connector "c3" targets unknown id "dbb" — did you mean "db"?`) → model patches only the offending lines. Cap at 2–3 rounds; then lenient repair (drop/auto-fix) with warnings.
- **Streaming & progressive rendering:** a line/block-oriented DSL can be parsed incrementally — each completed top-level block (a screen, a node) is compiled and rendered as it arrives (Gamma-style "watch it build"). JSON streaming needs partial-JSON parsers (`partial-json`, `best-effort-json-parser`) and is fragile. Design FluxScript so every screen is independently compilable.
- **Two-phase generation** (outline → content) improves structure and gives a cheap human checkpoint; also allows parallel generation of screens.
- **Docs for AI:** publish `llms.txt` (index) and `llms-full.txt` (FluxScript reference + shape catalog + examples) and expose the same as an MCP resource; keep a compact "cheat sheet" (< 3 K tokens) for system prompts; generate the shape/token catalog from plugin manifests so it's always current.

### B.2 Proposal: FluxScript authoring DSL

**Design goals:** YAML-shaped (familiar, streamable per block, comments allowed), no coordinates required, ids are slugs, references by id, theme via token names, layout via intent, animations/interactions declarative, plugin shapes by namespaced type, Mermaid/Markdown blocks embeddable. Parsed with a YAML 1.2 parser (e.g. `yaml` package, which keeps source ranges for error messages) plus a tiny edge-shorthand parser.

```yaml
# FluxScript v1
flux: 1
title: How our checkout works
theme: { preset: ocean, mode: auto, accent: "#7C5CFF" }   # tokens derived from seed
uses: [core, aws-icons@3]                                   # plugin packs (pinned in lockfile on compile)

screens:
  - id: intro
    kind: title                     # layout archetype from template library
    title: How checkout works
    subtitle: From cart to confirmation in 400 ms
    notes: Keep it under a minute.

  - id: arch
    title: Architecture
    layout: { type: layered, direction: right, spacing: comfortable }
    nodes:
      web:   { shape: aws.cloudfront, label: Web }
      api:   { shape: rounded, label: API Gateway, tone: accent }
      pay:   { shape: service, label: Payments, badge: PCI }
      db:    { shape: cylinder, label: Orders DB }
      queue: { shape: queue, label: Events }
    groups:
      backend: { label: Backend, contains: [api, pay, db], style: dashed }
    edges:
      - web -> api: HTTPS
      - api -> pay: charge()
      - api -> db
      - pay ~> queue: { label: event, style: async, flow: dots }  # animated flow along connector
    steps:                            # build timeline; each step on click
      - show: [web, api]
      - show: [pay, db]; highlight: api
      - animate: { target: "pay ~> queue", effect: flow, rider: coin, duration: 1.2s }
    interactions:
      - on: click pay
        do: { popup: pay-detail }
      - on: click db
        do: { goto: data-model, transition: zoom }

  - id: pay-detail
    kind: popup
    markdown: |
      **Payments** retries 3× with exponential backoff.
      - Idempotency key per order
      - 3-D Secure when required

  - id: data-model
    title: Data model
    mermaid: |                       # importer compiles to native shapes
      erDiagram
        ORDER ||--o{ LINE_ITEM : contains
        ORDER }o--|| CUSTOMER : "placed by"

  - id: kpis
    title: Results
    layout: { type: grid, columns: 3 }
    nodes:
      a: { component: core.stat, props: { value: "-38%", label: Cart abandonment } }
      b: { component: core.stat, props: { value: 400ms, label: p95 latency } }
      c: { component: acme.chart@1, props: { kind: line, data: ref(asset:q3-latency.csv) } }
```

**Language elements**

| Concept | Syntax | Compiles to |
|---|---|---|
| Theme | `theme: {preset, mode, accent, fonts}`; element styles reference tokens: `tone: accent`, `fill: color.surface.raised` | `theme` record (DTCG tokens) + token refs in element styles |
| Layout intent | `layout: {type: layered|tree|radial|grid|flow|stack|free, direction, spacing, align}`; optional `pin: {x, y}` or `near: api, side: below` hints | Layout plugin run (ELK layered/mrtree/radial in a worker; grid/stack native); results cached as absolute geometry in canonical records with `layoutSource` so a human drag converts to "pinned" |
| Nodes | `id: {shape, label, …}` or `component:` for React shapes | `shape`/`component` records |
| Connectors | `a -> b` (directed), `a -- b` (undirected), `a <-> b`, `a ~> b` (async/dashed), `a.right -> b.left` (anchors), value = label or object | `connector` records with bindings to anchors; router chosen by theme/default (orthogonal) |
| Animations | `steps:` list of `show/hide/highlight/animate/morph/camera` with `after/with/on-click` triggers | `timeline` + `step` records |
| Interactions | `on: <event> <target>` / `do: {goto|popup|play|set|zoom|link}` | `interaction` records |
| Embedded foreign DSLs | `mermaid:`, `markdown:`, `d2:` (later), `csv:` data refs | Importer plugins → native records (editable) |
| Escape hatch | `raw:` block of canonical records | Passed through validator |

**Round-trip:** canonical → FluxScript **decompiler** exists too (lossy for absolute positions → emits `pin:` only for elements the human moved). This lets an LLM edit a human-refined document by reading compact FluxScript rather than big JSON.

### B.3 AI pipeline

```
prompt / source docs
   │
   ▼  (1) Outline pass  — structured output (small JSON schema: screens[{id, kind, title, intent, bullets}])
   │      human checkpoint (optional, Gamma-style)
   ▼  (2) Screen pass   — FluxScript per screen (parallelizable, streamed; each block compiled on arrival)
   ▼  (3) Compile       — parse → schema validate → semantic validate → resolve plugins/tokens
   │         └─ errors ──► (4) Repair: send compact error list; model patches lines (≤2–3 rounds) → lenient fix
   ▼  (5) Layout        — layout plugins in worker, connector routing, text fitting (measure with real fonts)
   ▼  (6) Quality lint  — overflow, overlap, contrast (WCAG 2.2), density, reading order; optional
   │                      vision-model critique of rendered PNG ("render → critique → patch")
   ▼  (7) Canonical records → editor (human refinement) → save .flux / export
```

**MCP server (`@fluxion/mcp`)** — the same ops as the editor command bus:

| Tool | Purpose |
|---|---|
| `get_catalog` | Shapes, components, layouts, token names, templates available (from installed plugins) |
| `get_document_outline` / `get_screen(id, format: fluxscript)` | Compact read-back (never dump raw canonical JSON by default) |
| `create_document(fluxscript)` / `upsert_screen(id, fluxscript)` | Bulk authoring |
| `apply_ops(ops[])` | Fine-grained typed patches: `add_node`, `connect`, `set_style`, `move_to_group`, `add_step`, `set_theme_token`… (strict schemas) |
| `validate()` | Returns diagnostics with paths/suggestions |
| `render_preview(screen, format: png|svg)` | Lets the model *see* results (vision critique loop) |
| `export(format)` | pdf/png/svg/pptx/html |
| Resources | `fluxion://docs/fluxscript`, `fluxion://docs/cheatsheet`, `fluxion://doc/current` |

Works with Claude (tool use, strict tools, MCP connectors, prompt caching of the cheat-sheet + catalog) and OpenAI (function calling with `strict: true`, Structured Outputs, Responses API remote MCP). Keep tool schemas small and flat; use enums sourced from the catalog.

### B.4 Importers & exporters

| Direction | Format | Approach |
|---|---|---|
| Import | **Mermaid** | Use `mermaid` parser (`mermaid.mermaidAPI.getDiagramFromText`) → graph → Fluxion nodes/edges + layout intent (pattern proven by `@excalidraw/mermaid-to-excalidraw`, which today fully supports flowcharts only — plan per-diagram-type converters: flowchart, sequence, class, ER, state, mindmap) |
| Import | **Markdown** (Marp/Slidev style) | `---` → screens; headings → titles; lists → bullet blocks; fenced `mermaid` → diagrams; frontmatter → theme |
| Import | **PPTX** | Unzip (fflate) → parse `ppt/slides/*.xml` (DrawingML) → text boxes, pictures, basic shapes (`prstGeom` map), theme colors/fonts → DTCG tokens; tables/charts as images or components; SmartArt → best-effort |
| Import | draw.io / Excalidraw / tldraw | JSON/XML → records (nice-to-have; broadens adoption) |
| Export | **SVG** | Native renderer output per screen; optionally embed the Fluxion package as metadata (Excalidraw-style editable SVG) |
| Export | **PNG** | Render SVG → canvas (or headless Chromium in CLI); embed compressed package in `iTXt` chunk `fluxion` (editable PNG) |
| Export | **PDF** | Browser print CSS (`@page` size per screen, one screen per page, builds flattened or per-step pages) or Playwright/Chromium in CLI; vector text preserved |
| Export | **PPTX** | `pptxgenjs`: native shapes/text where mappable, connectors as lines, complex/animated elements as SVG→EMF/PNG images; speaker notes; basic entrance animations only |
| Export | **Static HTML site** | Multi-page: each screen a route, shared player chunk, prerendered SVG for SEO/no-JS, `llms.txt` generated from content |
| Export | **`.flux.html`** | Self-contained player (see §A.2) |

---

## C. Theming

### C.1 Design-token format

- **W3C Design Tokens Community Group — Format Module 2025.10** is the **first stable version** (announced 2025-10-28). Key features: `$value`/`$type`/`$description`/`$extensions`, aliases `{color.brand.500}`, groups with `$extends` inheritance, composite types (typography, shadow, border, gradient, transition), **color values as objects with explicit color space** (`srgb`, `display-p3`, `oklch`, …, per CSS Color 4), and a Resolver/theming mechanism for modes (light/dark, brands, a11y variants). Reference implementations: Style Dictionary, Tokens Studio, Terrazzo; supported/in progress in Figma, Penpot, Sketch, Framer.
- **Decision:** Fluxion themes *are* DTCG token files (namespaced `$extensions["dev.fluxion"]` for Fluxion-specific things like connector/animation defaults). Import/export Figma/Penpot/Tokens Studio tokens for free.

**Fluxion token model (three tiers)**

| Tier | Examples | Who edits |
|---|---|---|
| **Primitive (ref)** | `color.blue.1..12`, `color.neutral.1..12`, `font.family.sans`, `size.4`, `radius.2`, `duration.fast` | Generated from seeds (palette generator) |
| **Semantic (sys)** | `color.bg`, `color.surface.raised`, `color.text.default/muted`, `color.accent.solid/on-solid/subtle`, `color.border`, `color.status.success/warning/danger`, `color.data.1..8` (categorical), `font.heading/body/mono`, `elevation.2`, `motion.emphasis` | Theme author / AI (`tone: accent` binds here) |
| **Component (comp)** | `shape.fill`, `shape.stroke`, `connector.stroke`, `connector.flow.color`, `screen.title.font`, `popup.bg` | Plugin defaults, per-document overrides |

Modes (light/dark/high-contrast) swap the semantic tier only. At runtime, tokens compile to **CSS custom properties** (`--flx-color-accent-solid`) on the screen root; theme switching = swapping a class/attribute, no re-render; SVG shapes use `fill="var(--flx-shape-fill)"`. For PPTX/PDF export tokens are resolved to literal values.

### C.2 Palette generation

| Tool / method | Strength | Use |
|---|---|---|
| **OKLCH** (CSS Color 4, Baseline) | Perceptually uniform lightness → predictable ramps and contrast; P3 gamut | Canonical color space for generation & storage |
| **culori** (JS) | Conversions, gamut mapping (`toGamut`/clamp chroma), interpolation, WCAG contrast, ΔE | Core palette math in editor + CLI (small, tree-shakeable) |
| **Material Color Utilities (HCT)** | Tonal palettes from a seed color; dynamic color schemes (tones 0–100 with guaranteed contrast deltas) | Alternative "Material-like" preset generator |
| **Radix Colors** | 12-step scales with defined semantic roles per step (1–2 backgrounds, 3–5 components, 6–8 borders, 9–10 solid, 11–12 text), light/dark pairs; custom palette generator | **Adopt the 12-step role convention** for primitives — it gives the AI and humans a clear rule for which step to use |
| **Adobe Leonardo** | Contrast-ratio-targeted color generation (ask for "4.5:1 against bg") | Generate text/UI colors to hit target ratios exactly |
| Data-viz palettes | Categorical sets tested for CVD (colorblind) distinguishability | `color.data.*` tokens; validate with CVD simulation |

**Generator algorithm (proposed):** seeds (accent + optional neutral tint + status hues) → OKLCH 12-step ramps (lightness curve per mode, chroma eased toward ends, hue drift for warmth) → gamut-map to sRGB (store P3 too) → assign semantic tokens by Radix step roles → **contrast solver** nudges L until WCAG targets pass → emit DTCG JSON. AI only supplies seeds/mood ("calm fintech", `accent: #7C5CFF`), never full palettes.

### C.3 Accessible contrast

- **WCAG 2.2 is the normative gate**: 4.5:1 body text, 3:1 large text (≥24 px or ≥18.66 px bold) and UI components/graphical objects (so **connectors and shape borders that carry meaning need 3:1** against the background).
- **APCA** (Lc values) is *not* adopted — WCAG 3 remains a Working Draft in 2026 and its contrast method is still TBD. Offer APCA as an advisory readout (useful for dark mode and thin fonts), never as the pass/fail criterion.
- Lint in the compiler/editor: text-on-shape contrast, connector-vs-background, label-on-connector, small text size on mobile scale, color-only encodings (suggest pattern/dash/icon redundancy), `prefers-reduced-motion` alternatives for animations.

### C.4 Fonts

| Topic | Recommendation |
|---|---|
| Sources | **Fontsource** (npm-packaged, self-hostable open fonts incl. variable versions) and Google Fonts API as a discovery catalog; never hotlink Google Fonts from files (privacy/GDPR, offline) |
| Embedding | Subset (HarfBuzz wasm via `subset-font`/`hb-subset-wasm`) to glyphs used + language range; WOFF2; content-addressed in `assets/`; license flag recorded (OFL ok to embed) |
| Variable fonts | Prefer one variable file (wght/opsz) over many statics; subset can pin unused axes → fewer bytes |
| Pairing | Curated pair presets in theme packs (e.g. Inter + Source Serif 4, Space Grotesk + IBM Plex Sans, Fraunces + Inter, JetBrains Mono for code), each with metric-compatible fallback stacks (`size-adjust`, `ascent-override`) to avoid layout shift and keep text-fitting deterministic |
| Text fitting | Layout measures text with the *embedded* font (canvas/`FontFace` loaded from asset) so AI-generated layouts are deterministic across machines |

---

## D. RECOMMENDATION

### D.1 File format: `.flux` (package) + `.flux.html` (portable player)

- **`.flux`** — ZIP container, MIME `application/vnd.fluxion+zip`. First entry `mimetype` (stored, uncompressed, EPUB/ODF-style magic so tools can sniff it). Primary format for saving, editing, exchange, git (unzip-able), MCP/CLI.
- **`.flux.html`** — self-contained HTML Player with the *same* `.flux` bytes embedded (base64 of the zip) + an inline bootstrap + inlined Player bundle. Opens offline in any modern browser; the Fluxion editor imports it by extracting the embedded package. Option "Include editor" is **not** recommended for v1 (≈ +1 MB); instead the Player has an "Open in Fluxion" button (hands the package to the web app via drag/drop or `postMessage` to a new tab).
- **`.flux.json`** — optional uncompressed single JSON (assets base64) for AI I/O, clipboard, tests. Editor accepts it.
- **Editable exports** — PNG (`iTXt` chunk) and SVG (`<metadata>`) carry the package when small (<~2 MB), Excalidraw-style.

### D.2 Container layout

```
deck.flux (zip)
├── mimetype                         "application/vnd.fluxion+zip"  (stored, first)
├── manifest.json                    format version, app version, title, created/modified, generator (e.g. "claude-opus-5.5 via fluxion-mcp"),
│                                    schemaVersions per record type, entry list with sha256, plugin lockfile, thumbnails
├── document.json                    { records: { id → record } }   (deflate)
├── source/deck.fluxscript           optional: last FluxScript the AI produced (for regeneration/diff)
├── theme/theme.tokens.json          DTCG 2025.10 tokens (also mirrored as a theme record)
├── assets/
│   ├── 3f9a…c1.webp                 content-addressed binaries (stored, not deflated)
│   ├── 8b12…9e.woff2                subset fonts
│   └── a7d0…44.svg                  optimized SVG (deflate)
├── plugins/
│   └── acme.chart@1.4.2/            index.js (ESM), manifest.json, sha256 pinned in root manifest
├── fallbacks/                       static SVG snapshots of plugin/component elements (for missing/untrusted plugins)
└── previews/cover.webp              thumbnail (OS previews, galleries, file pickers)
```

Record example (canonical, not AI-facing):

```json
{ "id": "shp_V1StGXR8Z5j", "type": "shape", "subtype": "core.rounded", "parentId": "scr_arch01",
  "index": "a1", "x": 320, "y": 140, "w": 180, "h": 72, "layoutSource": "auto",
  "props": { "label": "API Gateway", "tone": "accent" }, "style": { "fill": "{shape.fill.accent}" },
  "meta": { "slug": "api" } }
```

### D.3 Size estimates (order of magnitude)

Assumptions: 20 screens, ~15 elements/screen (300 records, ~350 B each JSON ≈ 105 KB raw), 2 subset variable fonts, 8 images.

| Component | Raw | In `.flux` (zip) | In `.flux.html` |
|---|---|---|---|
| document.json (+ tokens, manifest) | ~120 KB | ~15–25 KB (deflate ≈ 5–8×) | same bytes ×4/3 (base64) ≈ 20–33 KB |
| 2 subset WOFF2 fonts | — | ~60–120 KB (stored) | ~80–160 KB |
| 8 images (WebP, ≤1920 px, q≈0.8) | — | ~600 KB–1.2 MB | ~0.8–1.6 MB |
| Player runtime (React 19 + renderer + animation) | ~250–400 KB min | — (app provides it) | ~250–400 KB inline (or ~80–130 KB via compressed-bundle trick) |
| **Total, text/diagram-only deck** (no images) | | **~80–150 KB** | **~250–550 KB** |
| **Total, with images** | | **~0.7–1.4 MB** | **~1.2–2.2 MB** |

Player size budget: aim ≤ 150 KB gz-equivalent. Consider building the Player on **Preact (compat)** to save ~40 KB, but only if React-component plugins can target it; otherwise keep React and use the compressed-bundle bootstrap. Plugin bundles are extra (typ. 5–50 KB each).

### D.4 Schema & migration strategy

1. Define record schemas once in **TypeBox** (or Zod 4) in `@fluxion/schema`; generate: TS types, compiled validators, JSON Schema (canonical), JSON Schema (FluxScript + MCP ops, provider-strict subset), docs (`llms-full.txt`).
2. `manifest.schemaVersions` per record type & plugin subtype; migrations are `{id: "shape/3-add-anchors", up, down?}` in ordered sequences per type; store-level migrations for structural changes; plugins register their own.
3. Load path: sniff (zip/html/json/png/svg) → extract package → verify hashes → **migrate** → **validate** → **lenient repair** (defaults, drop dangling bindings, report) → store. Unknown types preserved.
4. Golden corpus: every released format version committed as fixtures; CI loads all of them with the current build.
5. Never persist derived data as truth: layout results are cached geometry flagged `layoutSource: auto` and recomputable; human edits flip to `pinned`.
6. CRDT-readiness: flat records, fractional indices, parentId trees, separate text records, op-based undo → can mount on Yjs or Loro later without format change (the `.flux` stays a snapshot; the CRDT update log could be an optional `sync/` entry).
7. Persistence: IndexedDB autosave per record (debounced), FSA handle save on Chromium, download fallback elsewhere, OPFS for large working copies.

### D.5 Plugin packaging & security

| Aspect | Decision |
|---|---|
| Package | Plugin = ESM bundle + `fluxion-plugin.json` (id `vendor.name`, exact version, `sdk` semver range, contributions: shapes/connectors/routers/layouts/animations/themes/fonts/components/importers/exporters, `permissions`: `network:[hosts]`, `storage`, `clipboard`), externals `react`, `react-dom`, `@fluxion/sdk` via import map |
| Distribution | Registry (npm-backed) + embedding into `.flux` (`plugins/`), pinned by version **and** sha256 in `manifest.pluginLock` |
| Trust tiers | **Core/first-party (signed)** → main realm; **Declarative-only plugins** (themes, palettes, fonts, SVG shape libraries, JSON layouts) → no code, always safe; **Code plugins from files/3rd parties** → sandboxed iframe (opaque origin) with RPC; user can "trust this publisher" to promote |
| Runtime hardening | Strict CSP (no `unsafe-eval`, `connect-src` only for declared hosts), Trusted Types + DOMPurify for any document HTML/SVG, SVGO+sanitizer on imported SVG, `postMessage` schema-validated, no plugin access to other plugins' state |
| Degradation | Missing/refused plugin → fallback snapshot render + "enable plugin" prompt; document never fails to open |
| Future | SES Compartments for pure-logic plugins; revisit ShadowRealm when it ships |

### D.6 AI authoring DSL (FluxScript) — summary

- YAML 1.2 surface + edge shorthand (`a -> b: label`, `a ~> b`, `a.right -> b.left`), slug ids, token-named styles (`tone: accent`), layout intents (`layout: {type: layered, direction: right}`), declarative `steps` and `interactions`, embedded `mermaid:`/`markdown:` blocks, `component:` for React shapes, `raw:` escape hatch. Example in §B.2.
- Bidirectional: compile (FluxScript → records) and decompile (records → FluxScript with `pin:` for human-placed elements).
- Delivered to models via `llms.txt`/`llms-full.txt`, an MCP resource, and a ≤3 K-token cheat sheet; catalog enums injected from installed plugins.

### D.7 AI pipeline — summary

Outline (strict JSON schema) → per-screen FluxScript (streamed, parallel, progressively rendered) → compile/validate → repair loop (≤3 rounds, compact diagnostics with suggestions) → layout/routing/text-fit in worker → quality lint (overflow, overlap, WCAG contrast) → optional render-and-critique with a vision model → canonical records → human refinement. Exposed identically via **MCP server**, CLI (`flux build deck.fluxscript -o deck.flux`), and in-app assistant; fine-grained `apply_ops` tools for conversational edits.

### D.8 Theming token model — summary

DTCG 2025.10 token files; three tiers (primitive 12-step OKLCH ramps à la Radix → semantic roles → component tokens) with modes swapping the semantic tier; generated from seeds with culori + contrast solver (Leonardo-style targets); WCAG 2.2 enforced, APCA advisory; CSS custom properties at runtime; fonts from Fontsource, subset to WOFF2 and embedded; curated pairings with metric-adjusted fallbacks. Theme packs = declarative plugins (no code).

### D.9 Open questions / spikes

1. `import()` of Blob-URL modules and `crypto.subtle` from `file://` `.flux.html` in Chrome/Firefox/Safari (opaque origin behaviour) — fallback paths.
2. Player runtime size: React vs Preact-compat vs Solid for the Player; impact on React-component plugins.
3. HTML/ZIP polyglot (SingleFile "universal") as a later size optimization — check mail/AV handling.
4. ELK (≈ 400 KB+ wasm/JS) in the Player vs shipping precomputed geometry only (recommended: Player never runs layout; only the editor does).
5. Whether to store FluxScript source in the package by default (useful for AI regeneration; small cost).

---

## Sources

- Excalidraw export utils & embedded scene: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export · https://deepwiki.com/excalidraw/excalidraw/6.2-json-serialization · https://github.com/excalidraw/excalidraw/discussions/3756
- mermaid-to-excalidraw: https://github.com/excalidraw/mermaid-to-excalidraw · https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api
- tldraw schema/migrations: https://tldraw.dev/reference/store/StoreSchema · https://tldraw.dev/examples/shape-with-migrations · https://tldraw.dev/reference/store/Migration · https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/utils/tldr/file.ts
- draw.io AI generation & embed: https://www.drawio.com/docs/reference/diagram-generation/ · https://www.drawio.com/docs/manual/export/export-diagram/ · https://github.com/pzl/drawio-read
- TiddlyWiki JSON tiddler store: https://tiddlywiki.com/static/TiddlerFiles.html · https://tiddlywiki.com/dev/static/TiddlyWiki.html
- SingleFile self-extracting HTML/ZIP: https://github.com/gildas-lormeau/Polyglot-HTML-ZIP-PNG · https://gildas-lormeau.github.io/singlefile-updates/version-1-22.html · https://github.com/gildas-lormeau/SingleFile/discussions/1269
- CompressionStream / brotli status: https://github.com/mdn/browser-compat-data/issues/29824 · https://github.com/httptoolkit/brotli-wasm
- File System Access API support: https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker · https://caniuse.com/native-filesystem-api · https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- ShadowRealm: https://github.com/tc39/proposal-shadowrealm
- Font subsetting: https://github.com/papandreou/subset-font · https://github.com/kyosuke/hb-subset-wasm · https://harfbuzz.github.io/harfbuzz-hb-subset.html
- CRDTs: https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026 · https://www.loro.dev/docs/performance · https://crdt.tech/implementations
- Claude structured outputs / strict tools: https://platform.claude.com/docs/en/build-with-claude/structured-outputs · https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
- LLM formats & diagram generation research: https://gist.github.com/statico/19db37b219db26ec919e402dbe101156 · https://arxiv.org/html/2510.25761v1 (DiagramEval) · https://arxiv.org/pdf/2310.12128 (DiagrammerGPT) · https://arxiv.org/pdf/2511.14967 (MermaidSeqBench) · https://arxiv.org/pdf/2509.24592 (BPMN Assistant) · https://www.eraser.io/guides/best-ai-diagram-tools-in-2025
- Gamma workflow: https://gamma.app/explore/content/guides/what-is-gamma-and-how-does-it-use-ai-to-build-presentations · https://gamma.app/explore/content/guides/ai-presentation-tool-card-based-layouts
- Design tokens (DTCG 2025.10): https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ · https://www.designtokens.org/tr/drafts/format/ · https://www.designtokens.org/
- WCAG 3 / APCA status: http://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html · https://yatil.net/blog/wcag-3-is-not-ready-yet
- Also relevant (not fetched this session, from general knowledge — verify when implementing): fflate (https://github.com/101arrowz/fflate), culori (https://culorijs.org), Material Color Utilities (https://github.com/material-foundation/material-color-utilities), Radix Colors (https://www.radix-ui.com/colors), Adobe Leonardo (https://leonardocolor.io), Fontsource (https://fontsource.org), SVGO (https://github.com/svg/svgo), SES/Hardened JS (https://github.com/endojs/endo), TypeBox (https://github.com/sinclairzx81/typebox), Zod 4 JSON Schema (https://zod.dev), pptxgenjs (https://gitbrent.github.io/PptxGenJS/), llms.txt (https://llmstxt.org), MCP (https://modelcontextprotocol.io), browser-fs-access (https://github.com/GoogleChromeLabs/browser-fs-access).
