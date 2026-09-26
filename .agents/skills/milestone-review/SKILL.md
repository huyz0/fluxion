---
name: milestone-review
description: Review a milestone's commits as a whole with a fresh agent, turn findings into dispositions (reopen, hand off, argue), and re-plan. Use at checkpoints (~every 8 commits) and always before declaring a milestone complete. Catches drift, contradictions between commits, abandoned conventions, and a wrong spec — which per-commit review cannot see.
---

# Milestone review (outer loop)

**Run by an agent that did not drive the milestone.** The driver dispatches a fresh one
(Claude: `milestone-reviewer` agent; Codex: a new session or the other vendor via
`node scripts/harness/run-reviewer.mjs --milestone M<N>`).

## Packet

`node scripts/harness/review.mjs milestone --milestone M<N>` prints: the plan
(`docs/milestones/M<N>.md`), the backlog rows with commits, `git log` of the milestone's
commits with stats, the completion gate's current output, requirement IDs covered/uncovered
(`check-trace` output), argued findings, and the range already reviewed at earlier checkpoints.

## Questions (answer each)

1. **Coherence** — do the commits form one design, or do they contradict each other (two
   helpers doing the same thing, naming drift, inconsistent error handling)?
2. **Spec fidelity** — does what was built serve the cited requirements, or something adjacent?
   Is any requirement or plan item silently dropped?
3. **Standards drift** — a convention followed early and abandoned later?
4. **Gate honesty** — can the completion gate go green while the milestone is not done? Are
   tests constraining (spot-check 3 tests by imagining a mutant)?
5. **Architecture** — layering, purity, contracts, public API growth, dependency additions.
6. **Plan health** — rows grew > 1.5× planned? Why, and what does it say about later milestones?

## Dispositions

| Disposition | When | Action |
|---|---|---|
| **reopen** | Affects a requirement of *this* milestone or makes its gate dishonest | New row in current backlog |
| **hand off** | Real, but belongs to a later milestone | Row in the receiving `M<k>.md` + roadmap "Deferred" table |
| **argue** | Not a defect, or a decision | Line in `.harness/baselines/review-argued.txt` |

## Record

Write `.harness/reviews/milestone-M<N>-<checkpoint>.json`
(`{milestone, range, reviewer, findings[], dispositions[], planDelta}`) and **stage it**
(tracked). The completion gate checks a final-checkpoint verdict exists covering HEAD's
milestone range. Update `docs/milestones/M<N>.md` "Learned" section with 1–3 lines.
