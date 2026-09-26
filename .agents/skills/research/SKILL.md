---
name: research
description: Find whether a question is already answered in docs/research, docs/architecture or ADRs before investigating fresh, and record new findings so the next agent doesn't repeat them. Use when choosing a library/algorithm, when unsure how something should work, or before writing an ADR.
---

# Research

## Look first (in order)

1. `docs/architecture/decisions/` — decided already? Follow it.
2. `docs/architecture/*.md` — the intended design.
3. `docs/research/` — options & evidence:
   `00` product · `01` rendering/editor engines · `02` layout/routing · `03` animation/interaction ·
   `04` file format/AI/theming · `05` engineering stack · `06` AI harness.
   Search by keyword (e.g. grep for the library name) rather than reading whole documents.

## If not answered

1. Timebox (≈ 20 tool calls). Prefer primary sources (official docs, repos, specs).
2. Verify versions/licenses at the source; mark anything unverified `(verify)`.
3. Record: append a dated section to the most relevant research doc (or a new
   `docs/research/NN-<topic>.md` if none fits) — question, findings with URLs, recommendation.
   Summarize in your own words; no long quotes.
4. If the finding drives a decision → [`adr`](../adr/SKILL.md).

## Never

Re-litigate an accepted ADR without new evidence · add a dependency found in research without
the dependency rules in `docs/standards/tech-stack.md`.
