# Spec-Driven Development

> Read when: planning or decomposing a milestone, picking the next task, writing acceptance
> criteria, opening a spec folder, finding that a spec or requirement is wrong, or closing a
> milestone.
> Family: Process · Related: [git.md](git.md), [review.md](review.md), [testing.md](testing.md)

Lightweight on purpose: most tasks are one backlog row. Specs are short, delta-based, and
backed by gates. The point is an unbroken chain from requirement to test that a fresh agent can
rebuild in under a minute.

## 1. The chain

```
docs/requirements/*.md        FR-/NFR- IDs, MoSCoW, increment R0–R8        (what)
  → docs/milestones/roadmap.md   milestone + completion command              (when, done = exit 0)
    → docs/milestones/M<n>.md    plan: a hypothesis, ≤ 20 tasks              (how, roughly)
      → docs/backlog/current.md  rows M<n>.<k>, EARS acceptance              (one commit each)
        → specs/<id>-<slug>/     optional change folder                      (when a row is not enough)
          → commit "M<n>.<k>: …" → test "FR-…: …"                            (evidence)
```

| # | Rule | Enforced by |
|---|---|---|
| 1 | A requirement nobody can verify is not accepted. An NFR without a measured number is marked **UNDERIVED**; never invent the number. | no gate — judgement |
| 2 | Every milestone in `roadmap.md` has a completion command `node scripts/gates/m<n>-complete.mjs`. A milestone without one cannot start. | `check-milestone-exit.mjs` |
| 3 | Only the **current** milestone is decomposed into `docs/backlog/current.md`. Closed milestones move to `docs/backlog/archive/M<n>.md`. | `check-size.mjs` (backlog length cap) |
| 4 | Every row cites ≥ 1 Req ID (or `HARNESS` for tooling work) and has EARS acceptance. | `check-trace.mjs` |
| 5 | Task IDs `M<n>.<k>` are stable and never reused, even when a row is dropped (mark it `dropped`, keep the row). | `check-commit-msg.mjs` (ID lookup) |
| 6 | Every commit subject starts with its task ID; every M requirement of completed increments is named by ≥ 1 test. | `check-commit-msg.mjs`, `check-trace.mjs` |

## 2. Completion gate first, and red

The first task of every milestone (`M<n>.1`) writes `scripts/gates/m<n>-complete.mjs`. It must
exit non-zero when committed; each failing leg names what remains.

```
$ node scripts/gates/m3-complete.mjs
✗ trace: FR-CON-004, FR-CON-007 have no test
✗ e2e: connectors.reroute-on-move.spec.ts missing
✓ perf: routing 200 connectors 212 ms (≤ 300)
✗ review: 5 commits not covered by a milestone review
2 of 4 legs green — M3 not complete
```

Legs are commands, not opinions: `check-trace --milestone`, named Playwright specs, bench
thresholds, fixture round-trips, milestone-review coverage, no open quarantines. If the gate
goes green while the milestone is obviously unfinished, that is a bug in the gate: stop and fix
the gate.

## 3. Decomposition rules

| # | Rule | Enforced by |
|---|---|---|
| 7 | A row fits one commit that leaves the tree green (typically ≤ 400 changed lines excluding goldens). | no gate — judgement; reviewer flags oversize |
| 8 | Rows are ordered so each builds on committed ones; the loop always takes the **top unblocked** row. | no gate — `next-task` skill |
| 9 | Refactors, dependency bumps, and golden regenerations are their own rows. | no gate — reviewer |
| 10 | If the top 3 rows are all `blocked`, stop: that is a planning problem for the human. | no gate — drive stop condition |
| 11 | Out-of-scope work discovered mid-task becomes a new row, never a silent addition to the current diff. | reviewer |
| 12 | Re-derive rows from the plan and current code; do not copy the plan's task list blindly — the plan is a hypothesis. | no gate — judgement |

## 4. EARS acceptance

| Pattern | Form | Example |
|---|---|---|
| Ubiquitous | THE SYSTEM SHALL … | THE SYSTEM SHALL store connector routes as derived data, not in the document |
| Event | WHEN <trigger> THE SYSTEM SHALL … | WHEN a shape moves THE SYSTEM SHALL reroute attached orthogonal connectors |
| State | WHILE <state> THE SYSTEM SHALL … | WHILE presenting THE SYSTEM SHALL pause ambient animations on hidden screens |
| Unwanted | IF <condition> THEN THE SYSTEM SHALL … | IF the file fails schema validation THEN THE SYSTEM SHALL return a structured error and salvaged document |
| Optional | WHERE <feature> THE SYSTEM SHALL … | WHERE the ELK pack is installed THE SYSTEM SHALL offer "layered (ELK)" layout |

Each criterion must be checkable by a test, a gate, or a bounded number ("within 16 ms", "≤ 150
kB gzip"). Words like *fast*, *nice*, *robust* are rejected.

## 5. Spec folders (optional)

Open `specs/<task-or-feature-id>-<slug>/` only when a row cannot carry the change: a new
package, a contract change ([contracts.md](contracts.md)), a design with real alternatives, or
more than ~3 rows sharing one design.

| # | Rule | Enforced by |
|---|---|---|
| 13 | The spec is reviewed (per [review.md](review.md)) and committed **before** implementation rows. | `check-reviewed.mjs` |
| 14 | `design.md` lists rejected alternatives; decisions with lasting effect become an ADR (`docs/architecture/decisions/ADR-NNNN-slug.md`, MADR 4). | no gate — reviewer |
| 15 | Requirement changes go through a spec + ADR and update `docs/requirements/` and `40-traceability.md` **in the same commit**. | `check-trace.mjs` (matrix vs requirement files) |
| 16 | When every task in `tasks.md` is done, the spec is **archived**: its delta is merged into the living docs (requirements, architecture, standards) and the folder moves to `specs/archive/`. | `m<n>-complete.mjs` (no open spec folders for the milestone) |

## 6. When the spec is wrong

1. Stop implementing. Do not bend the code to a wrong spec, and do not bend the spec silently.
2. If only the *approach* is wrong: amend `design.md`/the row in its own commit (`docs(spec)`),
   re-review, continue.
3. If a *requirement* or *acceptance criterion* is wrong: write an ADR, update the requirement
   and traceability in the same commit, and add a row for any code already built on it.
4. If it needs a human decision (product intent, conflicting standards): set
   `blockedReason` in `.harness/state.json`, mark the row `blocked`, and stop the loop.

## 7. Templates

### Backlog row (`docs/backlog/current.md`)

```md
| ID | Task | Req IDs | Acceptance (EARS) | State | Commit |
|---|---|---|---|---|---|
| M3.4 | Orthogonal A* router on sparse grid | FR-CON-004, NFR-PERF-005 | WHEN a connector has style `orthogonal` THE SYSTEM SHALL return a route of axis-aligned segments that does not enter any obstacle bbox; WHEN 200 connectors are routed THE SYSTEM SHALL finish in ≤ 300 ms | doing | |
```

States: `todo` → `doing` → `done` (Commit filled) or `blocked` (reason in a footnote).

### Spec folder

```md
<!-- specs/M3.4-orthogonal-router/proposal.md -->
# Orthogonal router
Why: FR-CON-004 … · Scope: in … / out … · Affected: packages/routing, contracts: Router interface (no change)

<!-- design.md -->
## Approach   ## Alternatives rejected   ## Risks   ## ADRs

<!-- tasks.md -->
- [ ] M3.4 sparse grid + A*            WHEN … THE SYSTEM SHALL …
- [ ] M3.5 nudging of parallel segments WHEN … THE SYSTEM SHALL …
```

### Milestone plan (`docs/milestones/M<n>.md`)

```md
# M3 — Connectors that route themselves
Increment: R2 · Depends: M2 · Completion: `node scripts/gates/m3-complete.mjs`

## Goal (one paragraph, user-visible outcome)
## Requirements in scope      FR-CON-001…007, NFR-PERF-005
## Decisions needed first     (links to open ADRs; empty before start)
## Completion gate legs       trace · e2e specs by name · perf numbers · milestone review
## Task hypothesis (≤ 20)     M3.1 completion gate (red) · M3.2 … 
## Risks
## Deferred (in / out)        | Finding | From | Disposition | Receiver |
```
