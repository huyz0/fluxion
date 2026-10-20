---
status: accepted
date: 2026-10-21
decision-makers: harness (M17.2; within FR-LAY-006 and FR-LAY-010; no requirement changes)
amends: ADR-0014 (§Merging: the `amend` rule)
---

# ADR-0046 — Live layout frames and incremental mode: a post-commit reactor that amends the edit it follows

## Context and Problem Statement

FR-LAY-010 asks for frames whose layout re-runs when their content changes, with the edit and the re-layout undone as one step.
FR-LAY-006 asks that layouts can run incrementally without destroying the mental map. Undo entries merge today only when two commits
share a `mergeKey` and an origin (ADR-0014 §Merging, `history.ts`), and most user edits carry no `mergeKey`, so a re-layout committed
after an edit would be a second undo step.

## Decision Drivers

- One user action, one undo step, also when a layout follows it.
- No re-layout storms: a drag commits up to 60 times a second.
- The reactor must never react to undo, redo, remote changes or its own commits.
- A re-layout must move as few nodes as it can (`LAYOUT_INCREMENTAL_MOVED_PCT`).

## Considered Options

1. **Run the layout inside each editing command.** Every command would need to know about layouts.
2. **A reactor after commit, committing with the user's `mergeKey`.** Fails for edits without a key.
3. **A reactor after commit whose transaction amends the open undo entry (chosen).**

## Decision Outcome

Option 3.

**Transaction option `amend`.** `TxOptions.amend?: true` (core, a contract addition): the commit's diff merges into the last undo
entry when that entry is still open (not sealed, nothing committed since it but other amends), whatever its `mergeKey` and origin; the
entry keeps its label, origin and `metaBefore`, and takes the amend's `metaAfter`. When no entry is open, the amend is recorded as an
entry of its own with origin `system`. An amend never opens a merge window of its own. This **amends ADR-0014 §Merging**: besides the same-`mergeKey`-and-origin rule, an
amend joins the open entry.

**Reactor.** The editor's live-layout reactor subscribes to commits. It ignores commits with origin `undo`, `redo` or `remote` and
its own (label `layout.live`). For a commit that adds, removes or resizes a child of a frame whose `layout.live` is true, it marks the
frame dirty and schedules one flush with `queueMicrotask` (through the editor's scheduler port). The flush re-lays out the dirty
frames, innermost first, in one transaction with `amend: true`.
- **Undo.** `Store.#commit` records history before it calls subscribers, and a microtask runs before the next input event, so the
  entry the edit opened is still the last open one when the amend arrives: one Ctrl+Z takes back the edit and its re-layout. A paste
  then a nudge are separate input events, each followed by its own flush, so they undo in two steps, each with its re-layout. Several
  commits in one task (a scripted or AI batch) share one flush, which amends the batch's last entry.
- **Delivery order.** The re-layout commits after the store's listener loop for the edit has finished, never re-entrantly inside it,
  so every subscriber (autosave's journal, source sync) receives the edit's diff before the re-layout's.
- **Async layouts.** A layout that resolves later (`force` in its worker above 200 nodes, every `layouts-elk:*` layout) records the
  store revision at dispatch. When it resolves at the same revision, it commits with `amend` as above. When anything was committed
  in between, it never amends: it commits as its own `system` entry if its frame was not dirtied again, and is discarded if it was
  (the newer flush supersedes it). So a re-layout never joins a later, unrelated undo entry.
- **Cost.** One re-layout per task with qualifying commits; a drag commits at most once per animation frame, so at most one per frame.

**Format.** `LayoutSpec` gains a typed optional `live: boolean` (a file-format change: schema minor version bump, a migration
fixture and tests in the commit that adds it, M17.11; AGENTS.md rule 6).

**Incremental mode.** `LayoutInput.changed?: readonly string[]` names the nodes added, removed or resized since the last run, and
`LayoutInput.previous?: { [id]: Box }` gives the last result.
- `force` warm-starts from `previous` (new nodes start at the mean of their neighbours) with a third of the iterations.
- Every other layout runs fully, then **reconciles**: the result is translated by the median offset of the unchanged nodes so the
  diagram stays where it was, and per connected component kept by that translation.
- A node **moved** when its box centre differs from `previous` by more than 0.5 px. The metric is the number of moved nodes among those
  in both `previous` and the result, divided by that count, in percent. `LAYOUT_INCREMENTAL_MOVED_PCT` (30, weakens up) bounds it on
  the incremental fixture (one node added to a 40-node tree, a 30-node force graph and a 20-node packing).

### Consequences

- Good: editing commands stay unaware of layouts; one Ctrl+Z takes back the edit and its re-layout.
- Good: the reactor's cost is one re-layout per task with qualifying commits, at most one per frame during a drag.
- Bad: `amend` is a new history rule to keep correct; its tests live beside `merge.test.ts` and the undo property suite.
- Bad: reconciliation by translation cannot keep the mental map of an algorithm that reorders (a tree whose new child sorts first);
  those cases are measured, not hidden, by the metric.

### Confirmation

Core tests: an amend after a user edit gives one undo entry, after a sealed entry its own. Layout test `incremental.test.ts` against
`LAYOUT_INCREMENTAL_MOVED_PCT`. E2E `layout.live-container.spec.ts`: adding a node to a live tree frame re-lays it out and one Ctrl+Z
removes both; a paste then a nudge inside one frame are undone in two steps, each with its re-layout.

## More Information

- `amend` is part of the core transaction contract (AGENTS.md rule 6): the commit that adds it updates the API report and tests.
- Responsive re-layout per breakpoint (FR-LAY-013) is M29's and will reuse the reactor.
