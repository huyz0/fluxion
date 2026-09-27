---
status: accepted
date: 2026-09-27
decision-makers: harness (M2 "Decide before coding"; within FR-DOC-002, FR-DOC-010, NFR-REL-005)
---

# ADR-0012 — Record IDs and fractional-index keys are own code in `@fluxion/schema`

## Context and Problem Statement

Every record needs a stable unique ID (FR-DOC-002: URL-safe, ≥ 64 bits of entropy) and every
ordered collection (screens, z-order, steps) is ordered by fractional-index strings, not arrays
(FR-DOC-010, 02-document-model §1). `schema` is a pure package: no `Math.random`, `crypto` or
clock (coding-typescript rule 15), so IDs come from an injected `Random` port and tests must get
the same IDs for the same seed (NFR-REL-005). The research names `nanoid` and
`fractional-indexing` (docs/research/01 §"Ordering", 04 §"IDs").

## Decision Drivers

- Purity and determinism: randomness only through a port; seeded runs are byte-identical.
- Licence policy (NFR-LIC-002, `LICENSES.allow` in `scripts/gates/thresholds.mjs`):
  `fractional-indexing` is CC0-1.0, which is not on the allowlist.
- Player size (NFR-SIZE-001): `schema` is bundled by the player.
- CRDT-friendliness (FR-DOC-010): reordering one item changes one record.

## Considered Options

1. **Own code**: a 16-char ID drawn from a 64-symbol alphabet through `Random`, and own base-62
   fractional-index keys.
2. **`nanoid` + `fractional-indexing`** from npm.
3. **ULID / UUIDv7 IDs and integer order with renumbering.**

## Decision Outcome

Chosen option 1, because both functions are small (tens of lines), the port makes `nanoid`'s
main value (secure randomness) moot, and option 2's ordering library is outside the licence
allowlist.

### IDs

- Alphabet `A-Za-z0-9_-` (64 symbols, URL-safe); length **16**: 96 bits of entropy
  (FR-DOC-002 asks for ≥ 64). Branded type `RecordId`; `isRecordId` checks
  `^[A-Za-z0-9_-]{16}$`.
- `createId(random: Random)`; `Random` is `{ next(): number }` returning a float in `[0, 1)`.
  Hosts pass a CSPRNG-backed implementation (M3 core wires it); `seededRandom(seed)`
  (mulberry32) is exported for tests, builders and seeded AI generation.
- Hand-written IDs in fixtures and FluxScript slugs are not `RecordId`s until parsed; the
  schema accepts any non-empty string of `A-Za-z0-9_-` up to 64 characters as an ID so that
  readable fixture IDs (`doc`, `s1`) remain valid, and `createId` is what the engine uses.

### Fractional-index keys

- Digits are base 62 in ASCII order `0-9A-Za-z`, so keys compare with plain string comparison
  (`compareKeys` = code-unit order; never `localeCompare`).
- Key = **integer part** + optional **fraction**. The integer part's head character fixes its
  length: `a`..`z` are non-negative integers with 1..26 digits after the head, `A`..`Z` are
  negative integers with 26..1 digits after it. The fraction never ends in `0`. The first key of
  an empty list is `a0`.
- `keyBetween(a, b)` (`null` = open end) returns a key strictly between; appending increments
  the integer part (key length grows logarithmically), inserting between neighbours extends the
  fraction by about one digit per halving. `nKeysBetween(a, b, n)` spreads `n` keys evenly by
  bisection. Invalid keys or `a >= b` return a `Result` error, never throw (coding rule 10).
- **Rebalancing** is not automatic: keys are unbounded strings and stay valid. When a sibling
  key exceeds 32 characters, the store (M3) may re-key that sibling list in one transaction
  with `nKeysBetween(null, null, n)`; this changes n records and is an explicit command, never
  a side effect of a single move.

### Consequences

- Good: no runtime dependency; deterministic by construction; the key grammar is documented
  here and checked by `isIndexKey`.
- Good: moving one item writes only that item's `index` (FR-DOC-010).
- Bad: we own the edge cases (integer overflow at `zz…`, the smallest key `A00…0`) — covered by
  property tests; exhausting the key space returns an error.
- Neutral: IDs are not time-ordered; nothing in the model needs that.

### Confirmation

- `packages/schema/src/ids.test.ts`: `FR-DOC-002: 1e6 ids have no collision`; every ID matches
  the pattern; a seeded `Random` reproduces the same IDs (M2.4).
- `packages/schema/src/fractional-index.test.ts`: `a < keyBetween(a, b) < b` over 10 000 pairs,
  `nKeysBetween` strictly increasing, and "reordering one screen changes exactly one record"
  (M2.5).

## Pros and Cons of the Options

### Own code

- Good: ~100 lines total, pure, no licence question, smallest bundle.
- Bad: must be property-tested to the same standard as a library.

### `nanoid` + `fractional-indexing`

- Good: widely used (tldraw, Excalidraw use the same key scheme).
- Bad: `fractional-indexing` is CC0 (not on the allowlist; an exception is a licence-policy
  change needing its own ADR); `nanoid` would be wrapped around the port anyway.

### ULID / UUIDv7 and integer order

- Good: sortable IDs; integers are simple.
- Bad: integer order forces renumbering siblings on insert (many records change per move),
  which breaks FR-DOC-010; time-based IDs need the clock in a pure package.

## More Information

Key scheme after David Greenspan's "Implementing Fractional Indexing" (2020), the design
`fractional-indexing` also follows; the code here is written from the description, not copied.

## Amendments

- 2026-09-27 (M2.4, M2.5): `isRecordId` accepts any 1–64 characters of the ID alphabet (the
  readable-ID rule under "IDs"); the exact generated shape `^[A-Za-z0-9_-]{16}$` is checked by
  `isGeneratedId`. Growth: inserting repeatedly at one spot extends the fraction by one base-62
  digit about every six inserts (`a0V`, `a0G`, `a08`, `a04`, `a02`, `a01`, `a00V`, …), so a
  32-character key takes on the order of 180 same-spot inserts. The key space never runs out:
  past the largest integer `after` extends a fraction, and before the smallest integer `A` +
  26 × `0` (not itself a key) `before` extends one, so there is no exhaustion error.
