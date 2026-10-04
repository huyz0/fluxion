---
status: accepted
date: 2026-10-04
decision-makers: harness (M11.3; within NFR-SIZE-001, FR-PRS-009, NFR-SEC-001 and architecture/04 and 08; no new runtime dependency; one subpath export moves)
---

# ADR-0026 — Player packaging: the `<fluxion-player>` element, the React wrapper, what is in the core and what is lazy

## Context and Problem Statement

M11 closes increment R1: the player must work in the studio, in any `.flux.html` and embedded in a page as `<fluxion-player>` (FR-PRS-009),
within 150 kB gzip with React included (NFR-SIZE-001). The one-file player is 729.6 kB, 224 kB gzip today, against that budget
(`docs/research/07-player-size.md`): two copies of `react-dom/server` reach it through `@fluxion/render`'s static-render entry (about 59 kB gzip
alone), Zod and the schema validators are about 39 kB, and React's client is the floor at about 63 kB. Which packaging serves the element, the
wrapper, the budget and the security rule that every opened file is untrusted (NFR-SEC-001)?

## Decision Drivers

- NFR-SIZE-001: the one-file player at or under `PLAYER_CORE_GZIP`; the threshold may not be raised.
- A `.flux.html` is one classic script under a CSP of known hashes (ADR-0154): it cannot fetch a chunk, so "lazy" there is code already in the file,
  which saves no bytes. Only an ESM build can code-split.
- NFR-SEC-001: a file is untrusted; markup is never built from strings of the file, SVG is sanitised, URLs are filtered.
- ADR-0017 and the layering gate: no new edges; `player` stays L4.
- One drawing path: the element, the studio's present mode and the one-file player use the same controller and views.

## Considered Options

1. **Keep everything in the root entries, trust nothing, keep Zod** (the status quo). Simple, 224 kB gzip, over budget by half.
2. **A React-compatible replacement for the client (Preact with a compat alias).** Saves about 60 kB gzip. A new runtime dependency in the player and a
   departure from NFR-SIZE-001's "React included"; the aliasing risk is in every `react-dom` feature the editor shares. Held back as the fallback.
3. **Split the server renderer out, replace Zod in the player by a lean reader, keep React.** Removes about 59 kB (server) and about 39 kB (Zod and
   the validators) alone-gzip; adds a reader to maintain and a differential test; no new dependency.
4. **Build the player without validation at all** and trust the file. Smallest; breaks NFR-SEC-001 for a hand-edited file.

## Decision Outcome

Chosen option: **3**, with 2 recorded as the fallback if the cuts of M11.5 and M11.18 do not reach the budget.

- **The element.** `<fluxion-player>` lives in its own entry `@fluxion/player/element`, which registers it on import (guarded: a second import does nothing).
  It attaches an open shadow root, mounts the React tree inside it, and adopts the content CSS through `adoptedStyleSheets` (a cloned `<style>` where that
  API is absent). The chrome is styleable from outside through `part` names (`stage`, `controls`, `progress`, `counter`, `button`). Attributes: `src`,
  `start`, `controls`; methods: `load`, `next`, `prev`, `goTo`; events: `fluxion-load`, `fluxion-position`, `fluxion-error`. `src` is fetched with
  credentials omitted; a page that wants more passes bytes to `load`.
- **The React wrapper.** `@fluxion/player/react` is a thin component over the same controller (props: `src` or `bytes`, `position`, `onPosition`);
  `react` is a peer dependency of that entry only.
- **The core and what is lazy.** The core is the loader, the controller and the screen views. In the ESM build the overview grid and the debug overlay are
  `import()`ed on first use. The one-file player holds only the core: a second deflated block loaded from a Blob URL ("compact mode", ADR-0003) is
  used only if M11.18 needs it, because its bytes are in the file either way.
- **The server renderer leaves the player's graph.** `renderDocumentToHtml` and its types move from `@fluxion/render`'s root export to the subpath
  `@fluxion/render/ssr`, in one commit (M11.5) that also updates its consumers and the places that name the root import: `packages/cli/src/render.ts`
  (the one importer in the repository), `packages/render/README.md` and `AGENTS.md`, `docs/architecture/04-rendering-and-editor.md` §2.2 and ADR-0015
  (an amendment line). The API gate records the new subpath report and the root report loses the export.
- **Zod is not in the player.** The player reads a file with a lean reader (`@fluxion/format/player`, a new subpath): the archive and its manifest hashes are
  verified as today, then `document.json` is read structurally (known record types, typed fields, a record that is not well formed dropped). The lean reader
  **does not migrate, repair or salvage**: a file whose `schemaVersion` is not the current one, whose `document.json` is truncated or whose structure it cannot read is
  refused with a message that says to open it in the studio (which migrates and repairs, FR-FIL-009), never half-drawn. What reaches the screen is built by the
  render views from typed fields (rich text from the JSON tree, never from strings; links through `safeLinkUrl`; images from assets checked by `sanitizeAsset`),
  so a field the validator would have rejected can change a value but cannot become markup. The validating loader with Zod stays in the studio and the CLI.
  Confirmation for the untrusted-input claim: (1) a differential test, for every current-schema fixture the two readers give the same document, and for every
  non-conforming fixture the lean reader refuses or drops and never throws; (2) the existing security corpus (`specs/security/corpus`, the sanitiser and rich-text
  cases) is run through the whole player path (`Fluxion.start` in a browser test): no script, no event-handler attribute and no unsafe URL ends up in the DOM;
  (3) a fuzz test over corrupted archives and documents: it never throws and the DOM has no element the render views did not create.

### Consequences

- Good: about 98 kB gzip alone (about 60 to 75 kB of the file) leaves the player without a new dependency; the three consumers share one controller.
- Good: the validating and the lean reader are tested against each other, so a schema change fails a test before it breaks a viewer.
- Bad: a second reader to keep in step with the schema (mitigated by the differential test, and by the lean reader being small and drawing-only).
- Bad: one subpath export moves; the CLI and the docs that name the root import change in the same commit, and a package outside this repository importing it from the root would break (the package is unpublished, version 0.0.0).
- Bad: an older-schema or damaged file that the editor repairs is refused by a one-file player: the file is not lost (open it in the studio, save again), but the presenter sees the message first.
- Neutral: the player core entry measured at 136.9 kB gzip in size-limit holds both server renderers and no `react-dom` client, so it is not a
  React-included figure and is not the number NFR-SIZE-001 is held to; the one-file player is.

### Confirmation

`pnpm exec size-limit` holds the `player-inline` entry at a ratchet (M11.2) that M11.5 lowers and M11.18 replaces with `PLAYER_CORE_GZIP`; the
differential and fuzz tests of the lean reader; `e2e/player.embed.spec.ts` drives the element and the wrapper in a plain page; the API gate carries
the `@fluxion/render/ssr`, `@fluxion/format/player`, `@fluxion/player/element` and `@fluxion/player/react` subpath reports.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Status quo | nothing to build | 224 kB gzip, over budget by half |
| Preact compat | about 60 kB less | new dependency, a departure from "React included", aliasing risk |
| Split SSR, lean reader (chosen) | about 98 kB less alone-gzip, no dependency | a second reader and its tests |
| No validation | smallest | an untrusted file is trusted |

## More Information

Evidence: `docs/research/07-player-size.md`. Related: ADR-0003 (file format, compact mode), ADR-0015 (static render path), ADR-0017 (hosts and packs),
ADR-0154 (the one-file player). Rows: M11.5 (the first cuts), M11.14 (the element and the wrapper), M11.18 (the remaining cuts).
