---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.63, independent plan review required before implementation)
---

# ADR-0175 — Free endpoints when duplicating a screen

## Context and Problem Statement

M18.62's real-store fixture exposed a valid connector bound to an element on another
screen. `screenRecordsToCopy` correctly excludes the external binding, but duplication
then fails `FLX_CONNECTOR_END_MISSING`: the copied end is neither bound nor free.
FR-SCR-002 requires undoable duplication; FR-CON-001 requires bound or free endpoints.
Editor clipboard already preserves omitted bindings as free ends at caller-resolved points.
Exact anchor resolution lives in routing (L2), which depends on core (L1).

## Decision Drivers

Preserve endpoint geometry, valid records, exact undo and deterministic pure core.
Keep existing internal-only callers compatible. Do not introduce a dependency cycle,
weaken validation or silently attach copies to original outside records.

## Considered Options

1. **Retain outside bindings.** Preserves references, but changes selection and caller ID
   semantics and leaves the copy coupled to another screen; rejected.
2. **Guess target centres in core.** Reuses deletion fallback behavior but moves non-centre
   anchors and ignores custom routing geometry; rejected.
3. **Caller-resolved free endpoints (chosen).** Follows clipboard behavior and keeps core
   pure; callers need to provide geometry for otherwise unsupported cross-screen copies.
4. **Keep the generic validation failure.** Avoids a contract change but leaves valid-screen
   duplication unresolved and gives callers no supported completion path; rejected.

## Decision Outcome

Add optional `freeEnds` to `screen.duplicate` arguments: a map keyed by original connector
ID, with optional `source` and `target` finite `{x, y}` points. Require a point only for a
selected connector end whose binding is not copied. Coordinates are already resolved in
screen-local space and copied without translation. Existing free ends stay unchanged;
internal bindings retain their current remapping. Never mutate the source or outside records.

Before writing, refuse missing required points with `COMMAND_ARGS` / `FLX_COMMAND_ARGS`
and `/args/freeEnds/<connector>/<end>`. Invalid supplied coordinates fail argument validation
at the offending coordinate path. Refusals publish no transaction. Ignore no malformed point
input. A successful duplicate remains one transaction in the existing record order.

The navigator supplies an endpoint reader using its existing store/render registries and
routing resolver, following the clipboard port pattern. Core receives only plain data;
it does not import routing. No new runtime dependency is needed. Direct command callers
can provide the same map; missing geometry receives the precise refusal above.

## Consequences and Compatibility

Legacy supported arguments remain valid; the new field is optional and additive. Previously
failing cross-screen calls gain a supported path and a clearer missing-input diagnostic.
No saved document schema/version changes, so no file migration is required. Tests must retain
legacy argument fixtures and verify the additive command schema. Implementation includes
core/editor changesets and any affected public API snapshots, without threshold changes.

## Confirmation

M18.64 implements the reviewed spec, real-store core cases, navigator integration and a browser
flow with non-centre endpoints, both external directions, internal/free ends, exact undo/redo,
and atomic missing/nonfinite-input refusals. Run full verification and independent review;
archive the spec into living docs after implementation. Mutation qualification remains M18.10.

## Links

- [Spec](../../../specs/archive/M18-screen-duplicate-ends/proposal.md)
- [Core architecture](../03-core-engine.md)
- [Connector requirements](../../requirements/12-connectors-anchors-routing.md)
- Existing precedent: `packages/editor/src/clipboard.ts` and `clipboard.test.ts`.
