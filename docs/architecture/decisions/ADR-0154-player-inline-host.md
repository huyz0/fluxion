---
status: accepted
date: 2026-10-04
decision-makers: harness (M10.28; within ADR-0017, FR-FIL-002, FR-EXP-001, NFR-SEC-002 and architecture/01-overview.md §2; no runtime dependency)
---

# ADR-0154 — `@fluxion/player-inline`: the host that builds the one-file player

## Context and Problem Statement

A `.flux.html` embeds a player that draws the document with no network, from a CSP that allows only inline scripts of known hashes
(NFR-SEC-002). The player package (`@fluxion/player`, L4) draws with `@fluxion/render`, but a document's shapes and connector markers are
definitions in first-party packs (`basic`), registered into core registries by a host (ADR-0017); the layering gate ranks packs above L4,
so the player cannot import one. Something has to bundle the player, `format` and the packs into one classic script, and the studio and
the CLI both have to be able to put that script into a file they write.

## Decision Drivers

- The saved file embeds the player only (overview rule 3); the packs it needs come in the same script.
- ADR-0017: a host lists the packs it bundles; the dependency is visible to `check-layering`.
- One bundle for every writer: the studio (browser) and the CLI (`fluxion convert`, Node) put the same bytes in a file.
- The lockfile cannot change beyond workspace links (the cloud container cannot re-record the gate budget): no new external package.

## Considered Options

1. **Bundle inside `apps/studio`.** The studio already depends on the packs; but the CLI could not reach the script, and the studio's
   own Vite build would grow a second, unrelated output.
2. **Let `@fluxion/player` import the packs.** Breaks ADR-0017's ranks.
3. **Ship shape definitions inside each file** (`plugins/<id>/defs.json`, architecture/09). The shape definitions are TypeScript functions,
   not data; this waits for the declarative definition format.
4. **A new L5 host workspace, `@fluxion/player-inline`**, that depends on `player`, `render`, `core`, `schema`, `format`, `sdk` and
   `basic`, and builds `dist/player.inline.js`.

## Decision Outcome

Option 4.

- **Location.** The plan (M10.md, task 7) put the bundle at `packages/player/dist/player.inline.js`; it is `packages/player-inline/dist/player.inline.js`
  now, and the plan row and the M10 gate say so.
- **Package.** `packages/player-inline`, layer L5, runtime dom, `dependsOn`: player, render, core, schema, format, sdk, basic. It lists no
  external package: React and React DOM are resolved from the player's own sources when bundling, and mounting lives in
  `@fluxion/player`, which gains a `mountPlayer(root, ...)` in M10.10 (it does not exist yet; `PlayerRoot` is only the React component),
  so this host is a thin entry that wires the packs, the hasher and the globals. Should a host ever need React itself, it lists
  `react` and `react-dom` from the catalog, which are already in the lockfile.
- **Build.** tsdown (already a root tool) builds two things: the usual ESM and types for the package, and `dist/player.inline.js`: one
  classic script (IIFE, browser platform, every dependency bundled, minified, no dynamic import, no `eval`, no network), which defines
  `window.Fluxion = { start(bytes, root) }`. It runs from `file://` and under the CSP of ADR-0003 (the CSP of architecture/08 §3 names the script by its SHA-256; the writer computes it).
- **Consumers.** The `.flux.html` writer in `@fluxion/format` takes the script as a string. The studio reads `player.inline.js` with
  Vite's `?raw` import; the CLI reads the file next to its own package; neither imports the bundle as code.
- **Size.** M10 records the size (a `player-inline` entry in `size-limit`) and enforces nothing; the budget comes with the full player in
  M11 (NFR-SIZE-001/002). The bundle includes React and React DOM.
- **Hashing.** The bundle hashes with SubtleCrypto where it exists and with a pure SHA-256 (in `format`) where it does not (a `file://`
  page in an engine without it).

### Consequences

- Good: the dependency edges are all declared and gated; the studio and the CLI write byte-identical players; nothing new in the lockfile.
- Good: the player package stays free of packs and of globals; the host owns both.
- Bad: another workspace to keep (manifest, docs row, API report none: it exports a version only).
- Bad: the first-party packs are code inside the player, so a document that uses a plugin's own shapes needs the plugin's bundle too
  (architecture/09; M27).

### Confirmation

- `check-layering` and the overview map list the new workspace and its edges; `workspace-shape` checks its files.
- A size-limit entry measures `dist/player.inline.js`; a browser test runs the built script and draws a screen from a `.flux`.
- A harness test (`CSP-friendly bundle`): the built script contains no `eval(`, `new Function`, `import(` or `fetch(`/`XMLHttpRequest`.
