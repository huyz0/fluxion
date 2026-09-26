---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0005 — Pluggable layout/routing pipeline with permissive defaults; ELK and libavoid optional

## Context and Problem Statement

Because the AI never computes coordinates (ADR-0004), layout and routing quality is the product.
We need layered, tree, radial, force, grid/stack/template layouts (FR-LAY-002/003), no overlaps
(FR-LAY-004), deterministic output (FR-LAY-008, FR-RTE-004), off-main-thread execution
(FR-LAY-007), obstacle-avoiding orthogonal connectors (FR-CON-004), and a licence-clean player
(NFR-LIC-002). Which libraries, and which architecture?

## Decision Drivers

- Permissive licences in core; copyleft only as optional, unmodified, separately loaded modules.
- Determinism (seeded RNG, canonical input order) across browser, worker and Node.
- Performance: 100-node layered layout < 200 ms, 200 orthogonal routes < 300 ms (NFR-PERF-005).
- Extensibility: layouts and routers are registries (FR-LAY-001, FR-RTE-001).
- The player must not need layout engines (NFR-SIZE-005).

## Considered Options

1. elkjs for everything
2. Commercial engines (yFiles, GoJS)
3. Cytoscape.js or graphology as the base
4. A staged pipeline of our own, with permissive libraries per algorithm and ELK/libavoid as
   optional packs

## Decision Outcome

Chosen option: **4**. Pipeline: measure → place → constrain (pins, VPSC overlap removal, snap) →
anchor selection → route (straight / bezier / own sparse-grid A* orthogonal) → nudge → label
placement → animated diff → one transaction. Every stage is a pure function of a serializable
snapshot.

Defaults:
- `@dagrejs/dagre` for layered (main thread);
- d3-hierarchy + d3-flextree for tree and mindmap;
- d3-force, seeded, for force;
- WebCola for constraints and overlap removal;
- own grid, stack and templates.

Optional packs:
- `layouts-elk` (elkjs, EPL-2.0) in a lazy worker;
- `routing-libavoid` (libavoid-js, LGPL-2.1 wasm) as a separate chunk.

Laid-out positions are baked into the file; routes are derived.

### Consequences

- Good, because the player core stays small and licence-clean; saved files contain no layout engine
  unless a live container needs one.
- Good, because algorithms are swappable, and the fast result (dagre / A*) can be refined by ELK
  when it loads.
- Good, because deterministic golden tests and a quality scorecard (overlaps, crossings, bends) are
  possible, and the same scorecard can be exposed to AI.
- Bad, because we own an orthogonal router and pin reconciliation — non-trivial code.
- Bad, because the best quality (ELK layered with ports, libavoid nudging) requires optional packs
  with licence notices.

### Confirmation

Golden `LayoutResult` snapshots, run twice for determinism. `vitest bench` budgets (NFR-PERF-005).
`check-licenses` per-pack allowlist. Fixture test: a static document contains no ELK chunk.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| elkjs only | top quality layered + ports | EPL in core; ~1 MB+; worker-only; overkill for templates |
| Commercial | best overall quality | licence keys and cost; conflicts with portable files |
| Cytoscape/graphology | many layouts | graph-analytics orientation; weak slide/template layouts and routing |
| Own pipeline + permissive libs | licence-clean, fast defaults, pluggable | more code of our own |

## More Information

Research: `docs/research/02-layout-and-routing.md` §1, §2, §8 (pipeline, types, phasing, licence
notes). Architecture: `../05-layout-and-routing.md`.
