# 10 — Responsive, Publishing, Export & Import

> Read when: working on responsive modes, breakpoints/overrides, portrait variants, touch
> gestures, `fluxion site build`, an exporter (PDF/PNG/SVG/PPTX/video) or an importer
> (Mermaid/Markdown/PPTX/draw.io/Excalidraw). Requirements: `16-…` (FR-RSP), `21-…` (FR-IMP,
> FR-EXP, FR-SITE), FR-LAY-013, NFR-A11Y-002. Research: `research/01` §6, `research/02` §8.7,
> `research/03` §9.4, `research/04` §B.4.

## 1. Responsive modes (FR-RSP-002)

A document picks a default mode in `document.settings.responsive`. A screen may override it.

| Mode | Behaviour | Best for |
|---|---|---|
| `fixed` (default) | the logical canvas (e.g. 1920×1080) is scaled by `min(vw/W, vh/H)` and letterboxed (FR-PRS-001); pinch-zoom/pan in present mode | decks, diagrams |
| `reflow` | the matching **breakpoint variant** of the screen is shown: its own logical canvas plus per-element overrides; a screen without a variant falls back to `fixed` | decks that must read well on phones |
| `scroll` | screens are stacked vertically like a web page; each is fitted to width; builds are driven by scroll position (FR-RSP-006) | info sites, long-form stories |

In all modes the renderer is the same `<ScreenView>` (01 §3). Only the canvas size, the applied
overrides and the camera change, so present, edit preview and site output stay identical.
Resize and orientation change re-evaluate the mode without reload and keep `(screen, step)`
(FR-RSP-007).

## 2. Breakpoints and override records (FR-RSP-003, FR-RSP-005)

```ts
interface BreakpointDef {                 // document.settings.breakpoints, first match wins
  id: string;                             // 'portrait' | 'narrow' | custom
  when: { orientation?: 'portrait' | 'landscape'; maxWidth?: number; maxAspect?: number };
  canvas: { w: number; h: number };       // logical size of the variant, e.g. 1080×1920
  minFontPx?: number;                     // effective CSS px floor, default 14 (FR-RSP-004)
}
interface ScreenBreakpoint {              // screen.breakpoints[bpId]
  layout?: Partial<LayoutIntent>;         // e.g. { direction: 'down' } → re-run layout
  background?: Background; hidden?: boolean;
}
type OverrideKey = `bp:${string}` | `state:${string}`;
interface ElementPatch {                  // element.overrides[key]  (02: element.overrides)
  transform?: Partial<Transform>; hidden?: boolean; fontScale?: number;
  style?: Partial<Style>; index?: Index;
}
```

- Resolution: **base → breakpoint patch → state patch** (later wins, per field). The same resolver
  serves states (FR-SCR-007) and breakpoints, so the model has one override mechanism.
- Patches store only the fields that differ, so unspecified fields inherit from base (the
  Framer/Webflow model, research 01 §6.2). A reflow edit therefore never touches the base.
- In the editor, the breakpoint preview (device frame) makes the command layer write to
  `overrides['bp:<id>']` instead of the base record (FR-RSP-005). The inspector marks overridden
  fields and offers "reset to base".
- Layout results per `(screenId, bpId)` are baked into the override transforms (08 §8). The player
  never lays out. Switching orientation animates between the two baked geometries.

## 3. Auto portrait variant (FR-RSP-004, FR-LAY-013)

`command: screen.generateVariant({ screen, bp })` produces one undoable transaction:

1. **Target frame** = `bp.canvas` minus the safe area.
2. **Intent-driven containers** (screen or frame with `layout`): call the algorithm's
   `adapt(options, frame)` (research 02 §8.2) — `layered` right→down, `grid` 3→1 columns,
   `timeline` horizontal→vertical — then re-run layout with the same seed, pins removed.
3. **Free-positioned content**: build a reading order (explicit order, else y-bands then x), then
   stack groups vertically with template spacing and scale each to the frame width.
4. **Minimum font rule**: effective size = `fontSize × fontScale × (deviceCssWidth / canvas.w)` at
   the reference 390 CSS px width. Any text below `minFontPx` gets a `fontScale` bump, then it is
   re-measured and re-laid out (≤ 3 iterations).
5. **Checks**: overlap (FR-LAY-004), off-screen and text-overflow lint (06 §7). Failures remain as
   diagnostics on the variant; nothing is silently dropped.
6. **Write** only the differing fields as `bp:` patches, plus `screen.breakpoints[bp].layout`.

The AI mode "make portrait variant" (FR-AI-008) produces the same result as a patch. It starts from
the heuristic output and adjusts emphasis/hiding, and it is checked by the same step 5.

## 4. Touch and gestures (FR-RSP-001)

| Gesture | Present mode | Notes |
|---|---|---|
| swipe ← / → | next / previous (build step first, then screen) | horizontal threshold + velocity |
| tap | next build step; a hotspot or interactive element gets the tap instead | configurable "tap zones" |
| pinch / two-finger pan | bounded camera zoom into the screen (not browser zoom) | `touch-action: none` on the stage only |
| double-tap | zoom to the tapped element; again → fit | |
| long-press | hover equivalent (tooltips, hover triggers, FR-INT-001) | |
| scroll (scroll mode) | step progress via IntersectionObserver / scroll position | reduced motion → steps snap |

Gestures are a small recognizer over Pointer Events inside `player`, within its bundle budget
(NFR-SIZE-001). Touch targets for interactive elements are ≥ 44 px effective, which a lint rule
checks at the portrait breakpoint.

## 5. Static site generation (`fluxion site build`, FR-SITE-001..004)

```
fluxion site build deck.flux [more.flux…] -o dist/ [--template docs|landing|portfolio|report]
  1 load        load → migrate → validate (08 §9); exit 1 on errors
  2 plan        pages from sections (FR-SCR-004): one page per section (scroll mode) or per screen;
                routes /<section-slug>/<screen-slug>/ ; prev/next, breadcrumbs, sidebar/top nav
  3 measure     Node TextMeasurer with the document's embedded fonts → same geometry as the browser
  4 prerender   React 19 `react-dom/static` prerender of each page: <ScreenView> in its
                final-build state, inline SVG + HTML text, CSS variables from theme tokens,
                routes baked, a11y text for connectors ("A connects to B: label", NFR-A11Y-002)
  5 hydrate     shared player chunk `_fluxion/player.<hash>.js` + per-page records JSON;
                `hydrateRoot` attaches builds, interactions, riders; scroll-driven builds
  6 search      client index (MIT full-text lib, verify licence) over text, labels, notes → lazy JSON
  7 meta        <title>/description per page, OpenGraph image 1200×630 rendered via the PNG exporter,
                sitemap.xml, robots.txt, llms.txt generated from content
  8 emit        dist/ static files; no server required
```

- Pages must read with JS disabled (FR-SITE-002). Hydration only adds motion and interactivity.
  The a11y and performance target is Lighthouse ≥ 90.
- **Single-file site** (FR-SITE-004) is a `.flux.html` with the site shell template and hash
  routing (`#/section/screen`). It reuses the 08 §3 structure.
- **Multi-document sites** (FR-SITE-005, R8): a `fluxion.site.yaml` manifest lists documents and
  cross-document links (`goto: other.flux#screen`).
- Site templates are declarative packs (themes plus shell layout tokens), so they need no code.

## 6. Exporters (`@fluxion/exporters`, R7)

Exporters register in the `exporters` registry. They run in the studio (browser) and/or the CLI
(Node + Playwright Chromium).

```ts
interface ExporterDef {
  id: 'pdf' | 'png' | 'svg' | 'pptx' | 'video' | string;
  runsIn: Array<'browser' | 'node'>;
  options: ZodType;                                          // shown in the export dialog + CLI flags
  export(doc: DocSnapshot, opts: unknown, ctx: ExportContext): Promise<ExportOutput>;
}
```

| Format | Approach | Fidelity notes |
|---|---|---|
| **PDF** (FR-EXP-002) | CLI: Playwright `page.pdf()` on the player in `export` mode with print CSS `@page { size: W H; margin: 0 }`, one screen per page; options: per build step, notes pages. Studio: the same print stylesheet through the browser print dialog. | vector shapes, selectable text, embedded fonts; visual diff vs render ≤ 1 % |
| **PNG / JPEG / WebP** (FR-EXP-003) | studio: standalone SVG → `Image` → canvas at 1–4× → `toBlob`; CLI: Playwright element screenshot at `deviceScaleFactor`. Transparent background option. PNG can carry the package in an `iTXt` chunk `fluxion` (editable PNG, < 2 MB). | same renderer, so pixels match present mode |
| **SVG** (FR-EXP-004) | SSR of `<ScreenView>` to standalone SVG; rich text becomes `<text>/<tspan>` from measured line breaks (no `foreignObject`, so Inkscape works); fonts embedded as `@font-face` data URLs or outlined via fontkit glyph paths; package in `<metadata>` | components use their snapshot |
| **PPTX** (FR-EXP-005) | **pptxgenjs** (MIT; its jszip dependency is taken under MIT of the MIT/GPL dual licence — confirm in `check-licenses`). Basic shapes → preset geometry (`rect`, `roundRect`, `ellipse`, `diamond`, `can`…); other outlines → custom geometry; connectors → lines/elbows with arrowheads (unbound); text → editable text boxes with runs; tokens → resolved literals; notes → speaker notes; components/effects → snapshot images. | animations are not mapped; option "builds as slides" emits one slide per step |
| **Video / GIF** (FR-EXP-006) | CLI only. Default: Playwright `recordVideo` of the player in auto-advance mode (WebM). Deterministic mode: `VirtualClock` stepping + frame screenshots at N fps, encoded by a **system** ffmpeg if present (not bundled, licence). | duration = Σ step durations + transitions |
| Mermaid, FluxScript, JSON (FR-EXP-007/008) | `dsl` decompiler / Mermaid emitter for diagram screens; 08 §4 | lossy for Mermaid |

## 7. Importers

```ts
interface ImporterDef {
  id: string; extensions: string[]; mimes?: string[];
  sniff?(head: Uint8Array): boolean;
  import(input: Uint8Array | string, ctx: ImportContext):
    Promise<{ fluxscript?: string; doc?: DocSnapshot; diagnostics: Diagnostic[] }>;
}
```

The rule: **semantic sources emit FluxScript** (so layout, lint, decompile and AI tooling apply).
**Geometric sources emit records** with `placement: 'pinned'` to keep the author's layout.
Parsers are heavy and stay in lazy chunks in the studio/CLI, never in the player.

| Source | Req | Approach |
|---|---|---|
| **Mermaid** | FR-IMP-001, FR-DSL-007 | `mermaid` parser (lazy) → per-diagram converters: flowchart, sequence-lite, mindmap, timeline, class/ER lite → FluxScript nodes/edges + layout intent (`layered`, `tree`, `mindmap`…) |
| **Markdown** | FR-IMP-002 | mdast (micromark): `---`/H1–H2 → screens; bullets → text blocks with archetype templates; fenced `mermaid` → diagram screens; frontmatter → theme seeds |
| **PPTX** | FR-IMP-003 | fflate unzip → DrawingML XML: `sp` + `prstGeom` → shape defs map; `pic` → assets; `cxnSp` with `stCxn/endCxn` → bound connectors; `graphicFrame` tables → table; charts/SmartArt → image fallback; theme colors/fonts → DTCG tokens; notes. Target ≥ 80 % of fixture elements |
| **draw.io** | FR-IMP-004, FR-LIB-006 | `<diagram>` inflate (deflate-raw + base64 + URI decode) → `mxGraphModel`; style strings → def + style map; edges with `source/target` → bindings; stencils via the draw.io stencil converter |
| **Excalidraw** | FR-IMP-004 | JSON elements → rect/ellipse/diamond/text/image/arrow; bound arrows → bindings; `files` → assets; roughness → optional sketch effect (FR-THM-011) |
| D2 / DOT | FR-IMP-005 (C) | later; same FluxScript-emitting pattern |

Mermaid and Markdown importers live in `dsl` (01 §2). PPTX, draw.io and Excalidraw importers live
in `exporters` (the R7 import/export package) and register through the same registry. Every
importer keeps fixtures next to its code. The test asserts that the result compiles, validates and renders, plus the element coverage percentage
where the requirement states one.
