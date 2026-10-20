// The cheat sheet (FR-AI-002, NFR-AI-002): the page a model reads with the catalog before it writes FluxScript or a patch. It is plain text in
// a module so every host (the CLI, the docs build, the MCP server of M15) ships the same words; the tests compile its example, name every key the
// compiler reads and every op of the patch, and count it in the token budget (M14.8).

/**
 * The FluxScript and AI patch cheat sheet: grammar, rules, one compiling example, the patch ops.
 *
 * @public
 */
export const CHEAT_SHEET: string = `# FluxScript cheat sheet

You state intent; the engine places and routes. Never write coordinates unless you must pin a box.

## A document (YAML, flux: 1)

\`\`\`yaml
flux: 1
title: Support ticket triage
uses: [basic]
screens:
  - id: triage
    title: Triaging a ticket
    layout: { type: layered, direction: right }
    nodes:
      new:    { shape: ellipse, label: Ticket received, tone: accent }
      urgent: { shape: diamond, label: How urgent? }
      page:   { shape: rounded-rect, label: Page on-call }
      queue:  { shape: rounded-rect, label: Add to the queue }
      close:  { shape: ellipse, label: Closed, pin: { x: 900, y: 300 } }
    edges:
      - new -> urgent
      - urgent -> page: now
      - urgent -> queue: later
      - page -> close
      - queue -> close: { label: done, route: orthogonal }
\`\`\`

## Keys

- top: flux, title, theme, uses, lineJumps (true: lines hop where they cross), screens
- theme: preset, name, overrides
- screen: id, title, layout, background, nodes, groups, edges, notes
- node: shape, text, label, tone, style, pin, alt (node names are slugs: lowercase letters, digits, hyphens)
- group: label, contains, style, layout
- edge: "a -> b: label" or { from, to, op, label, style, route, jumps: arc|gap|none }; ops are -> <- <-> -- ~>; an end may name an anchor: a.e -> b.w
- pin: { x, y, w?, h? } keeps a box where you put it

## Rules

- Shape names resolve through uses: (rounded-rect for basic:rounded-rect when unique); use the catalog's ids.
- Style by token name (tone: accent), not by colour.
- Each screen compiles on its own. Omit layout to get layered.
- Fix diagnostics by their hint; the path is a JSON pointer into the file.

## Edit with a patch (JSON)

\`{ "flux": 1, "baseRevision": "r41", "ops": [ ... ] }\` applies all ops or none. Refs are slugs, #<RecordId>, or edge keys a->b.

- add: { op, screen, slug, node, parent? }
- update: { op, target, set } (an edge target sets label, style, route, jumps; jumps: default clears)
- remove: { op, target, cascade? }
- connect: { op, edge: "a -> b: label", spec?: { label?, style?, route?, jumps? } }
- disconnect: { op, target }
- setLayout: { op, scope, layout: { type, direction?, spacing?, gap?, columns?, ... }, relayout? }
- restyle: { op, targets: [refs] or { select: { screen?, shape?, tone?, kind? } }, style }
- addStep: { op, screen, at?, step }
- addInteraction: { op, owner, rule }
`;
