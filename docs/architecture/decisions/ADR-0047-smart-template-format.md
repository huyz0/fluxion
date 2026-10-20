---
status: accepted
date: 2026-10-21
decision-makers: harness (M17.2; within FR-LAY-014 and FR-LAY-003; no requirement changes)
---

# ADR-0047 — Smart templates: a `TemplateDef` that builds shapes from an items list, named from DSL, AI and the editor

## Context and Problem Statement

FR-LAY-014 asks for SmartArt-like templates (process, cycle, hierarchy, pyramid, matrix, venn, funnel, timeline, comparison),
selectable by name from the DSL and AI, each rendered from a list of items. A layout (`LayoutAlgorithm`) only places boxes that
exist; a template must also create the shapes, connectors and styling, and stay editable afterwards.

## Decision Drivers

- A template is chosen by name and fed plain items: the DSL and the AI patch stay short (token budget, FR-AI catalog).
- The result is ordinary records: after it is built, the user edits shapes like any others; no hidden template runtime in the player.
- Themes apply: a template names theme roles per slot, not colours.
- Portrait screens: a template can adapt (a horizontal process becomes vertical).
- Pure and deterministic: building is a function of items, options, theme and frame.

## Considered Options

1. **Templates as layouts plus style presets** applied to shapes the author wrote. The author still writes every shape and connector.
2. **Templates as stored components** (a symbol instance). Needs the component system of a later milestone and hides the shapes.
3. **A `TemplateDef` whose `build` returns records; the frame remembers the template and its items (chosen).**

## Decision Outcome

Option 3.

```ts
type TemplateItem = { readonly label: string; readonly detail?: string; readonly children?: readonly TemplateItem[] };
type TemplateDef<O> = {
  readonly id: string;                 // 'process.chevron', 'cycle.basic', 'hierarchy.org', 'pyramid', 'matrix.2x2', 'venn', 'funnel', 'timeline.milestones', 'comparison', ...
  readonly version: string;
  readonly items: ZodType<readonly TemplateItem[]>; // e.g. matrix.2x2 exactly 4, venn 2-3, comparison 2 columns
  readonly schema: ZodType<O>;         // options: direction, spacing, variant
  readonly slots: { readonly [slot: string]: { readonly shape: string; readonly role: string } }; // role → theme variant
  build(items: readonly TemplateItem[], options: O, ctx: TemplateContext): TemplateResult; // shapes and connectors in frame space
  adapt?(frame: Box, options: O): O;   // e.g. a portrait frame turns direction right into down
};
```

- `TemplateContext` carries the frame box, the theme and the text measurer (`@fluxion/core`'s port), so slots grow to fit their labels
  before placing.
- `TemplateResult` is a list of element and connector drafts (shape def id, box, label, slot role) that the editor's `template.apply`
  command, the DSL compiler and the AI patch turn into records in one transaction. Each built element carries
  `semantic: { template: { id, slot, index } }`, and the frame stores `layout: { type: 'template', id, items, options }`, so the
  template can be re-built after the items change (and a frame with `live: true` re-builds through ADR-0046's reactor).
- Templates live in `packages/layout/src/templates/`, registered in a `templates` registry beside `layouts` (same `registerX` and
  `listX` pattern), so packs add templates.
- **DSL:** a screen or frame takes `template: process.chevron` with `items:` (strings or `{ label, detail, children }`) and optional
  `options:`; it compiles to the drafts above. The AI catalog lists each template's id, items schema and one-line purpose within the
  catalog token budget; the patch op `setLayout` accepts `{ type: 'template', id, items, options }`.

### Consequences

- Good: the player renders templates as ordinary shapes; no new player code.
- Good: one registry, one options form (the M17 options form reads `schema` as it does for layouts).
- Bad: a re-build replaces the template's shapes, so a manual edit of a built shape is lost on re-build unless the shape was
  detached (its `semantic.template` removed); the editor warns before a re-build that would drop edits.
- Bad: `LayoutSpec` (today a loose object: `type` matching `LAYOUT_TYPE`, optional `options`) gets a refinement for
  `type: 'template'` that requires and validates `id` (a template id) and `items` (an array of items): a file-format change, with a
  schema minor version bump, its migration fixture and tests in the commit that adds it (M17.14; AGENTS.md rule 6).

### Confirmation

`templates.test.ts` builds each template from an items list and compares to its golden, with theme variants; the DSL example
`examples/dsl/templates.flux.yaml` compiles and renders; `token-budget.test.ts` keeps the catalog within budget.

## More Information

- Templates are a layout-family contract, so `@fluxion/layout` owns them; the editor owns `template.apply` and the warning.
