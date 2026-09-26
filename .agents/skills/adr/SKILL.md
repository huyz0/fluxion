---
name: adr
description: Record an architecture decision (MADR). Use when making a choice that is expensive to reverse, adding a runtime dependency to the player, changing a contract (file format, schema, SDK API, FluxScript grammar, CLI --json, MCP tools), deviating from a standard, or when a milestone plan lists a decision to make before coding.
---

# ADR

Location: `docs/architecture/decisions/ADR-NNNN-<slug>.md` (next free number; never reuse).
Template: MADR 4 — see `docs/architecture/decisions/README.md`.

## Steps

1. Check `docs/research/` (skill `research`) and existing ADRs — maybe it's decided.
2. Write: context & problem, decision drivers (cite FR/NFR IDs), ≥ 2 considered options with
   one-paragraph pros/cons each, decision outcome, consequences (good/bad), confirmation (which
   gate/test will show the decision holds), links.
3. Status:
   - `accepted` — if the decision is within an existing requirement and standard, and a
     reviewer agrees (`code-review --kind plan`);
   - `proposed` + **stop** — if it changes scope, a requirement, licensing posture, or the
     file format major version: a human decides.
4. Superseding: new ADR with `Supersedes ADR-XXXX`; edit the old one's status only.
5. Update the index in `docs/architecture/decisions/README.md` and, if the decision changes a
   rule, the relevant standard — same commit.
