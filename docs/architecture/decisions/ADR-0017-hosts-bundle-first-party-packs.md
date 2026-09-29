---
status: accepted
date: 2026-09-29
decision-makers: Fluxion maintainers (M5.8, delegated to the driver)
---

# ADR-0017 — Hosts bundle first-party packs as listed dependencies

## Context and Problem Statement

From M5 the basic shapes are definitions in `packs/basic`, registered through the SDK
(FR-SHP-002, FR-EXT-001, ADR-0016). Whatever draws a document has to load them: the CLI now, the
studio in M6, later the MCP server and the exporters. The layering gate ranks packs above every
package layer (`Pack: 6`, next to apps). So `cli` (L5) cannot depend on `pack-basic`, even though a
pack depends only on `sdk` (L4). Loading packs dynamically by name would hide the dependency from
the gate and from the bundler. How do hosts get the first-party packs?

## Decision Drivers

- Dogfooding: packs use only the public SDK (01-overview rule 4); nothing about that changes.
- Every dependency edge is visible to `check-layering` and `dependency-cruiser`, and each one is
  listed in the overview map.
- One way to load a pack for every host: register it through the SDK into core registries.

## Considered Options

- **A. Rank packs at 5** (the host layer). A host lists the packs it bundles under "May depend on".
- **B. Dynamic import by package name** at run time, with no declared dependency.
- **C. Studio-only packs**: only apps (rank 6) load packs, and the CLI renders placeholders.

## Decision Outcome

Chosen option **A**.

1. `check-layering` ranks the Pack layer 5. Packs keep depending only on `sdk` (the `packs/*` row).
   L5 hosts (`cli`, later `mcp` and `exporters`) and apps may depend on a pack, but only if their
   "May depend on" cell names it.
2. A host builds core registries through the SDK and registers each bundled pack under the pack's
   id (`basicPack.register(registries)`). Registration failures are the host's diagnostics.
3. `cli` lists `sdk` and `basic`.

### Consequences

- Good, because the dependency is declared, gated and bundled, with no string-named imports.
- Good, because third-party packs will load through the same `register` call (M8, FR-EXT-*).
- Bad, because a pack could in principle list another L5 package; the map is the guard, and the
  `packs/*` row lists only `sdk`.

### Confirmation

`check-layering` (rank change, map rows), `tests/harness` layering cases, and the CLI test that the
basic pack is registered when a document is rendered.

## More Information

01-overview §2 (package map), ADR-0007 (plugin trust: first-party packs are trusted and in-page),
ADR-0016 (shape definitions).
