---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0007 — Plugin manifest, import-map shared deps, sandboxed iframe for untrusted code

## Context and Problem Statement

Plugins contribute shapes, components, routers, layouts, effects, themes, tools and importers
(FR-EXT-001..008). Saved files embed the player bundles of the plugins they use (FR-PKG-002).
Those files travel: a file from a stranger may carry arbitrary JavaScript. How do we package,
load, share dependencies with, and isolate plugin code without breaking portability?

## Decision Drivers

- Opening any file must be safe (NFR-SEC-001, NFR-SEC-003): no access to the parent DOM, storage
  or cookies for untrusted code.
- Documents must never fail to open or lose data because of a plugin (FR-EXT-008, NFR-REL-004).
- React components need a singleton React (hooks) and the SDK (FR-PKG-004).
- First-party packs use the same API as third parties (dogfooding, FR-EXT-001).
- Lazy loading, and only used player code embedded (FR-EXT-004, NFR-SIZE-004).

## Considered Options

1. Run all plugin code in the main realm (trust everything)
2. Web Workers only (no DOM plugins)
3. SES/Hardened JS compartments
4. ShadowRealm
5. Tiered trust: first-party and user-trusted in page; declarative packs need no code; untrusted
   code in a sandboxed iframe (opaque origin) behind a typed RPC; snapshots as fallback

## Decision Outcome

Chosen option: **5**.
- **Packaging**: `fluxion-plugin.json` (reverse-DNS `id`, short `namespace`, exact version,
  `engines`, static `contributes`, `activationEvents`, `permissions`, `settings`) plus separate
  `player` / `editor` / `worker` ESM entries, packed as `.fluxpack` with per-file sha256.
- **Loading**: plugins import bare `react`, `react-dom`, `react/jsx-runtime`,
  `@fluxion/sdk/player`, resolved through an **import map** to the host's instances. The fallback
  is specifier rewriting when a map cannot be installed.
- **Isolation**: untrusted code runs in `sandbox="allow-scripts"` iframes with a strict `srcdoc`
  CSP and schema-validated `MessageChannel` RPC.
- **Fallback**: missing or refused plugins render their saved **snapshot**.

### Consequences

- Good, because files from anywhere open safely and remain viewable.
- Good, because trusted plugins get full React integration with no RPC overhead.
- Good, because saved files carry only the player code actually used, pinned by hash.
- Bad, because sandboxed components cost an iframe each (pooled, visible-only) and cannot provide
  synchronous contributions (routers, samplers); those elements render static until trusted.
- Bad, because import maps from `file://` and dynamic insertion need a spike; the rewrite fallback
  adds a small lexer to the player.

### Confirmation

Security E2E: sandboxed plugin tries to read parent DOM, storage and cookies and fails. Bundle check:
a plugin bundling React is rejected; a player entry importing editor code is rejected. Integrity
test: a tampered bundle is blocked and its snapshot shown. Missing-plugin fixture round-trips byte
for byte.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Trust everything | simplest, fastest | any shared file can run arbitrary code with app privileges |
| Workers only | isolated | no DOM/React components |
| SES compartments | same-realm isolation for logic | not for DOM/React; adds weight; good later for logic-only plugins |
| ShadowRealm | native isolation | TC39 Stage 2.7, not shipped |
| Tiered + iframe sandbox | safe default, full power when trusted, proven (Figma, Observable) | RPC and iframe cost for untrusted components |

## More Information

Research: `docs/research/04-file-format-ai-generation-theming.md` §A.4, §D.5;
`docs/research/01-rendering-and-editor-engines.md` §3.5. Architecture: `../09-extensibility.md`,
`../08-file-format.md` §10.
