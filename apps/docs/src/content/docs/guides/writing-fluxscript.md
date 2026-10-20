---
title: Writing FluxScript
description: Write a diagram-screen deck as text, compile it to a Fluxion document, and read the diagnostics when it does not.
---

FluxScript is the text form of a Fluxion document: a YAML file, usually named `*.flux.yaml`, that names screens, nodes and edges and
leaves coordinates to the engine. People edit it in the studio's Source view, and AI models write it because it costs a fraction of
the tokens of the JSON document. `@fluxion/dsl` compiles it; the grammar is frozen by ADR-0030 (`flux: 1`).

Every block marked `yaml flux` on this page is compiled by the repository's tests.

## A first file

```yaml flux
flux: 1
title: How checkout works
theme: corporate
uses: [basic]
screens:
  - id: overview
    title: Overview
    layout: { type: stack, direction: right, gap: 60, align: center }
    nodes:
      web: { shape: rounded-rect, label: Web }
      api: { shape: rounded-rect, label: API, tone: accent }
      db:  { shape: cylinder, label: Orders DB }
    edges:
      - web -> api: HTTPS
      - api -> db
```

| Key | Meaning |
|---|---|
| `flux` | Required. Must be `1`, else `FLX_DSL_VERSION`. |
| `title` | Required. The document title. |
| `theme` | A preset name (`theme: dark`), `{ name: pastel }`, or `{ preset: corporate, overrides: { … } }` with token overrides. |
| `uses` | The shape packs your shape names come from (`basic` has `rect`, `rounded-rect`, `diamond`, `cylinder` and more). |
| `screens` | Required. A list of screens; each has an `id`. |

Slugs (screen ids, node and group names) are lower case: `[a-z][a-z0-9-]*`. A node or group slug is unique in the whole document.

## Nodes

A node is a slug with a shape and a label, or free text.

```yaml flux
flux: 1
title: Nodes
uses: [basic]
screens:
  - id: nodes
    layout: { type: stack, direction: down, gap: 24, align: center }
    nodes:
      plain:   { shape: rect, label: Plain }
      accent:  { shape: rounded-rect, label: Accent tone, tone: accent }
      danger:  { shape: rounded-rect, label: Danger tone, tone: danger }
      heading: { text: A free text line, style: { font.size: font.size.lg, font.weight: font.weight.bold } }
      boxed:   { shape: rect, label: Own colours, style: { fill: color.primary, font.color: color.background } }
      dashed:  { shape: rect, label: Dashed outline, style: dashed }
      pinned:  { shape: note, label: Pinned, pin: { x: 1500, y: 800 } }
```

| Key | What it does |
|---|---|
| `shape` | A shape from a pack in `uses` (`rect`, or qualified `basic:rect`). A name two used packs both define is `FLX_DSL_AMBIGUOUS_SHAPE`. |
| `label` / `text` | The text of a shape / a free text element. |
| `tone` | `accent`, `success`, `warning`, `danger`: a named style variant of the theme. |
| `style` | Token names, never raw values: `fill`, `stroke`, `stroke.width`, `font.size`, `font.color`, `font.weight`, `font.family`, `opacity`, `radius`. A bare `solid`, `dashed` or `dotted` is a stroke preset. |
| `pin` | `{ x, y, w?, h? }` in screen units. The engine keeps a pinned node exactly where you put it. |
| `alt` | Alternative text for assistive technology. |

Tokens come from the theme (`color.primary`, `font.size.lg`, …). An unknown token is `FLX_TOKEN_UNKNOWN`. Prefer tokens to literal
values: they keep the deck re-themable.

## Groups

A group draws a labelled frame around nodes of the same screen.

```yaml flux
flux: 1
title: Groups
uses: [basic]
screens:
  - id: backend
    layout: { type: stack, direction: right, gap: 48 }
    nodes:
      api:  { shape: rounded-rect, label: API }
      pay:  { shape: rounded-rect, label: Payments }
      web:  { shape: rounded-rect, label: Web }
    groups:
      services: { label: Services, contains: [api, pay], style: dashed }
    edges:
      - web -> api
```

## Edges

An edge is one line, `<from> <op> <to>`, with an optional label after a colon.

| Op | Meaning |
|---|---|
| `->` | Arrow at the target |
| `<-` | Arrow at the source end |
| `<->` | Arrows at both ends |
| `--` | No arrows |
| `~>` | Async: dashed, arrow at the target |

An end is a slug, or `slug.anchor` where the anchor is `n`, `e`, `s`, `w` or a named anchor of the shape. Anything else is
`FLX_DSL_EDGE_SYNTAX`, reported at its column. For more than a label, use `: { label, style, route, jumps }` after the edge, or write the
object form with `from`, `to` and `op`.

```yaml flux
flux: 1
title: Edges
uses: [basic]
screens:
  - id: edges
    nodes:
      hub:   { shape: ellipse, label: Hub, pin: { x: 860, y: 440, w: 200, h: 200 } }
      north: { shape: rect, label: North, pin: { x: 860, y: 120, w: 200, h: 100 } }
      east:  { shape: rect, label: East, pin: { x: 1300, y: 490, w: 200, h: 100 } }
      queue: { shape: rect, label: Queue, pin: { x: 860, y: 860, w: 200, h: 100 } }
    edges:
      - hub.n -> north.s: straight up
      - hub.e <-> east.w: { label: both ways, route: curved }
      - hub.s ~> queue.n: { label: async, route: orthogonal, style: dotted }
      - { from: north.e, to: east.n, op: "--", route: polyline }
```

`route` is `straight`, `curved`, `orthogonal` or `polyline`. Routes are not stored in the document; the renderer computes them.

Where two connectors cross, the one drawn later can hop over the other. `lineJumps: true` at the top of the file turns arcs on for
the whole document; an edge's `jumps: arc`, `gap` or `none` sets its own style and overrides the document's. Connectors between the
same two nodes are drawn side by side, 16 px apart.

## Layouts and pins

Give a screen `layout: { type: stack, direction: down, gap: 40, align: center, padding: 120 }` and the engine places the nodes you did not
pin. Pinned nodes stay where they are. With no `layout`, a screen is laid out by `layered`, which ranks the nodes along the edges. A group takes its own `layout` for its members.

`layered` takes `direction` (`down`, `right`, `up` or `left`) and `spacing` (`compact`, `comfortable` or `spacious`), or `nodeGap` and `rankGap` in px:

```yaml flux
flux: 1
title: Flow
uses: [basic]
screens:
  - id: flow
    layout: { type: layered, direction: right, spacing: compact }
    nodes:
      a: { shape: rect, label: Start }
      b: { shape: rect, label: Check }
      c: { shape: rect, label: Done }
    edges:
      - a -> b
      - b -> c
```

Text is not measured yet, so a node has its shape's default size.

## What is not compiled yet

FluxScript v1 already names more than the compiler turns into records. The rest is read, kept and warned about with
`FLX_DSL_NOT_YET`; it is never an error and never lost.

| Where | Kept, not compiled |
|---|---|
| top level | `vars`, `settings`; `theme.mode` and `theme.accent` |
| screen | `kind` (archetypes) and its arguments, `steps`, `interactions`, `breakpoints`, `markdown`, `mermaid`, `raw` |
| node | `component`, `image`, `icon`, `badge`, `props`, `near` |
| edge | `flow`, `riders` |

```yaml flux
flux: 1
title: Deferred sections
uses: [basic]
screens:
  - id: story
    title: Story
    nodes:
      a: { shape: rect, label: A }
      b: { shape: rect, label: B }
    edges:
      - a -> b
    steps:
      - show: [a]
      - show: [b]
```

This compiles to a document with the two nodes and the edge, plus `FLX_DSL_NOT_YET` on `steps`. The text of `steps` is stored in
`document.source`, so `decompile` writes it back in place and a later compiler version compiles it.

## Diagnostics

Every problem is a diagnostic with a code, a place, a message and, when the compiler can, a hint. A typo in a key or a shape name gets
the nearest valid name:

```yaml
flux: 1
title: Typos
uses: [basic]
screens:
  - id: typos
    nodes:
      a: { shap: rect, label: A }
      b: { shape: rectangle, label: B }
    edges:
      - a -> bb
```

`formatDiagnostics` turns the list into one line each: errors first, then by position, duplicates removed, capped at 20 with `+N more`.
The lines for this file:

```text
L7:12  error   FLX_DSL_UNKNOWN_KEY  "shap" is not a key here — hint: did you mean "shape"?
L8:19  error   FLX_DSL_UNKNOWN_SHAPE  no used pack has a shape "rectangle" — hint: packs used: basic
L10:14  error   FLX_REF_MISSING  edge end "bb" is not a node or group of screen "typos" — hint: did you mean "b"?
```

The codes are stable. [FluxScript diagnostics](/reference/fluxscript-diagnostics/) lists every one with its severity. The
compiler also reports the document schema's codes (`FLX_REF_MISSING`, `FLX_TOKEN_UNKNOWN`, `FLX_SCHEMA_*`). In `lenient` mode a field the
schema refuses is removed and reported as a warning that says what was removed; the default `strict` mode reports it as an error.

## The Source view

In the studio, the left panel has a Source tab. It loads on first use, so it costs nothing until you open it.

- It shows the current screen as FluxScript, with the document header above it read-only. Switching screens switches the text.
- Type, and 300 ms after the last keystroke the text compiles and applies to the canvas as one undo step. If the text has errors,
  nothing is applied: diagnostics show in the gutter and the canvas keeps its last good state.
- Edit the canvas, and the text follows when the Source view is clean. If you are typing or have unapplied text, it shows
  "Canvas changed, reload" and waits for you. Blur applies pending keystrokes first.
- Only what you changed in the text is written. A field you did not touch keeps whatever the canvas gave it.
- `# kept: 3 records not shown` marks records the text form cannot express yet (an image, free rich text). They stay as they are.
- Completion offers shape ids, token names and, after an edge op, the slugs of the screen.
- Renaming a slug changes the record id; the view maps the old id to the new one, so selection and undo survive.
- Undo has two scopes. Inside the editor, Mod-z and Mod-Shift-z (or Mod-y) undo and redo the typing in the text, and a Reload you ask for is one step of them (unless the Reload changed the header, for example after a new title: that one cannot be undone and starts the text history over); they never touch the document, and the history lasts while the screen is open. The text you get back is your edit like any other, so after the pause it is applied to the canvas as one more step. The Undo of the toolbar, or Mod-z with the canvas focused, undoes the document, one step per applied edit. A text regenerated by itself after a canvas change (a drag, a new title) is not a step: it starts the text history over, so Mod-z never brings back the text from before the change.

The TextMate grammar `packages/dsl/grammar/fluxscript.tmLanguage.json` highlights `*.flux.yaml` in VS Code and other editors.

## Streaming

A model writes the screens one at a time. `createStreamSplitter` cuts a text stream into the header and one block per screen as each
one completes; `createStreamCompiler` compiles each block into the running document, so a screen renders the moment its block ends.
After `end()` the running document equals the compile of the whole text.

Write the header (`flux`, `title`, `theme`, `uses`) first and `screens:` last. A top-level `uses`, `theme`, `title` or `flux` key after
`screens:` can change how earlier screens compile, so the stream compiles everything again at `end()` and that result wins. Keep the
`screens:` line alone at column 0.

## Same source, same bytes

Compiling the same text with the same options and registries gives a byte-identical `.flux.json`. Record ids are a hash of the
document's salt and the record's key, so a screen block that did not change keeps its ids when you recompile it, and diffs stay
small. The salt is chosen once, stored in `document.source.salt`, and kept by every later compile with that document as its `base`.

## Decompile and round trip

`decompile(doc, { registries })` writes canonical FluxScript for a document, and `decompileScreen` writes one screen. The result
compiles back to the same document: `compile(decompile(doc))` equals `doc`. Records the text form cannot express are counted in
`kept` and left out of the text, not damaged. Hand-made records get slugs generated from their labels.

## What the command line does today

`fluxion validate` and `render` read a `.flux.json` file, and `fluxion convert` moves a document between `.flux`, `.flux.json` and
`.flux.html`. There is no `fluxion compile` command for FluxScript yet; compile from code, or use the studio's Source view.

```ts
import { compile, decompile, formatDiagnostics } from '@fluxion/dsl';

const { doc, diagnostics } = compile(text, { registries });
for (const line of formatDiagnostics(diagnostics)) console.error(line);
const back = doc ? decompile(doc, { registries }).text : undefined;
```

`registries` holds the packs and layouts of your host (see the package README).

## Limits

- Flow-style `screens: [...]` is not streamed; the whole text is then the header.
- YAML anchors, aliases, tags and duplicate keys are errors.
- Measured text, archetypes, steps, interactions and the Mermaid and Markdown importers come in later milestones.
