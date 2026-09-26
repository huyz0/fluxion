---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0003 — `.flux` zip + `.flux.html` self-contained player + `.flux.json`

## Context and Problem Statement

A Fluxion document must be one portable file that includes content, theme, assets and used plugin
code (FR-FIL-001). It must present when double-clicked in any browser, offline (FR-FIL-002,
NFR-PORT-002), stay compact for storage and AI pipelines (FR-FIL-003, NFR-SIZE-003), and have a
diffable text form for git (FR-FIL-005). Which container(s) should we use?

## Decision Drivers

- Opens without installing anything; works from `file://` with the network blocked.
- Small: binaries are not base64-inflated, JSON is compressed.
- Human- and AI-readable canonical model; compression only at the container level.
- Robust loading: migration, repair, salvage; forward-compatible preservation of unknown data.
- Security: an opened file is untrusted; embedded code is integrity-checked.

## Considered Options

1. Plain JSON with base64 assets as the only format
2. JSON + gzip/brotli
3. ZIP package (manifest + document + content-addressed assets + plugins)
4. Single HTML with inline player and JSON payload only
5. HTML/ZIP polyglot (SingleFile-style)
6. Combination: ZIP as the unit of truth, HTML wrapper embedding the zip, canonical JSON projection

## Decision Outcome

Chosen option: **6**.
- `.flux` is a deterministic ZIP (`mimetype` stored first, `manifest.json`, `document.json`, DTCG
  theme tokens, optional FluxScript source, `assets/<sha256>.<ext>`, used plugin player bundles
  with integrity, component snapshots, `preview.webp`).
- `.flux.html` embeds the exact zip bytes as base64 in a `<script type="application/octet-stream">`,
  with an inline player module, a small bootstrap and a strict meta CSP.
- `.flux.json` is the canonical, key-sorted, byte-deterministic pretty projection.

The studio saves `.flux.html` by default and converts losslessly among the three.

### Consequences

- Good, because one set of bytes (the zip) is hashed, versioned and embedded everywhere.
- Good, because base64 applies only to already-compressed bytes in the HTML wrapper.
- Good, because the HTML file is the product experience: double-click to present.
- Bad, because each `.flux.html` carries a copy of the player (~150 kB gzip budget) and is frozen
  at that player version (the studio re-wraps on save).
- Bad, because HTML attachments may be blocked by some mail gateways; `.flux` is the fallback.
- Neutral: the polyglot and the compressed-player "compact mode" stay spikes (research 04 §D.9).

### Confirmation

Golden fixtures per `formatVersion` load, migrate and round-trip in CI. Size fixture tests
(NFR-SIZE-003). E2E opens `.flux.html` from `file://` with the network blocked. A loader fuzz test
runs 10 000 corrupted inputs (NFR-REL-002).

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Plain JSON | trivial, diffable | +33 % on binaries, no compression, needs an app to open |
| JSON + gzip/brotli | smaller text | still base64 assets; brotli not universal natively |
| ZIP | compact, per-entry methods, partial reads, universal tooling | not browser-openable alone |
| HTML only | double-click to present | base64 on raw bytes, no compact storage form |
| Polyglot | smallest HTML | fragile offsets; AV/mail scanners flag polyglots |
| ZIP + HTML + JSON | all drivers met | three wrappers to test (mitigated: two are projections of the zip) |

## More Information

Research: `docs/research/04-file-format-ai-generation-theming.md` §A, §D.1–D.5. Architecture:
`../08-file-format.md`.
