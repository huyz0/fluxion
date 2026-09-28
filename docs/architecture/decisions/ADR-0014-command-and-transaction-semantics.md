---
status: accepted
date: 2026-09-28
decision-makers: harness (M3 "Decide before coding"; within NFR-MNT-006, FR-EDT-006, NFR-REL-003, NFR-PERF-006, FR-EXT-001)
---

# ADR-0014 — Command and transaction semantics of the record store

## Context and Problem Statement

ADR-0002 chose an own record store whose `transact()` is the only write path and whose
transactions emit record-level `Diff`s feeding undo, autosave and a future CRDT bridge.
03-core-engine sketches the API but leaves open what M3 must pin before coding: what a
transaction does on bad data or a throw, when two transactions merge into one undo step, what
undo stores and replays, in which order integrity hooks run, and what `store.fork()` and a
read-only store mean. Each choice shapes the NFR-REL-003 property (full undo restores the initial
document) and the NFR-PERF-006 budget (undo < 16 ms on 5 000 records).

## Decision Drivers

- NFR-MNT-006: every operation is expressible as record puts/deletes; no other change channel.
- NFR-REL-003 / FR-EDT-006: undo is exact and total; one gesture is one undo step.
- NFR-PERF-006: undo/redo cost is proportional to the records touched, not the document.
- FR-EXT-001: integrity hooks and commands come from registries, built-ins and plugins alike.
- coding-typescript rules 10–11: expected failures are values; `throw` only for broken invariants.
- NFR-REL-005: the same inputs produce the same diffs and history on every run.

## Considered Options

1. **Result-returning transactions, fixed-point hooks, strict merge adjacency, inverse-diff undo
   without re-running hooks, snapshot forks** (described below).
2. Throwing transactions (invalid data throws a `TransactionError`), hooks run once in
   registration order, time-window merging (e.g. 500 ms), undo by re-running inverse commands.
3. Immer-style patches instead of record diffs, undo through recorded patch lists.

## Decision Outcome

Chosen option 1.

### Transactions

- `store.transact(label, fn, opts?)` runs `fn(tx)` against a working copy. `tx.get` sees the
  transaction's own writes. `tx.put(record)` replaces a record, `tx.patch(id, partial)` produces a
  new frozen record (shallow merge of top-level fields), `tx.delete(id)` removes it.
- A `transact` called while another is open joins it: one transaction, one diff, one history
  entry. `batch(label, fn)` is that explicit grouping. The inner call returns `ok(value of its
  fn)` at once, provisionally: hooks and validation run only when the outermost transaction
  commits, and its `Result` is the authoritative one (a failure there rolls back every inner
  write). Only the outermost call's `opts` count; an inner `origin`, `mergeKey` or meta is
  ignored.
- The emitted `Diff` is the **net** change: `puts` maps an id to `{ before?, after }`, `deletes`
  maps an id to its `before`. A record created and deleted in the same transaction is absent; a
  write whose result deep-equals `before` is dropped. An empty diff notifies no subscriber and
  records no history.
- Commit order: `fn` → integrity hooks (below) → validation of the changed records (structural
  schema check, plus referential checks of the references those records hold or lose) → apply
  and notify. Validation is on by default and can be switched off only by a store option for
  production builds; tests never switch it off.
- **Failure is a value.** If validation reports an error diagnostic, or a hook exceeds the depth
  limit, nothing is applied and `transact` returns `err({ code, message, diagnostics })`; on
  success it returns `ok(value of fn)`. If `fn` or a hook **throws**, that is a programmer error:
  the working copy is discarded and the exception is rethrown. The store is unchanged in every
  failure case.
- `opts`: `origin` (`'user'` default, `'undo'`, `'redo'`, `'remote'`, `'system'`), `mergeKey`,
  and `metaBefore` / `metaAfter` (opaque values for undo, supplied by the caller for this
  transaction; below). Subscribers receive `(diff, { label, origin,
  mergeKey })`.

### Integrity hooks

- Hooks are registered in the `integrityHooks` registry under a key and see the pending diff and
  the transaction. They run after `fn`, **sorted by key** (not registration time, so the order is
  the same whatever order packs load in), and repeat as a pass over all hooks until a pass
  changes nothing (fixed point). A pass limit of 8 ends a non-converging set with
  `err` code `TX_HOOK_DEPTH`.
- Hooks do **not** run for `origin: 'undo' | 'redo'`: the inverse diff already contains the
  effects hooks had the first time, and re-running them could diverge.

### History (undo/redo)

- A committed transaction with `origin: 'user'` (or `'system'`) and a non-empty diff pushes one
  history entry: the diff (whose `before` snapshots are the inverse) plus the `metaBefore` and
  `metaAfter` the caller passed with this transaction: the editor captures selection and view
  when the gesture starts and when it commits, so undo restores the view the edit was made in,
  even after navigation that made no transaction (FR-EDT-006 "undo across screens restores
  view"). Core never reads either value; `undo()` returns `metaBefore`, `redo()` returns
  `metaAfter`.
- `undo()` applies the entry's inverse through `transact` with `origin: 'undo'`; `redo()` re-applies
  the diff with `origin: 'redo'`. Neither is recorded as a new entry. A new user transaction
  clears the redo stack. Depth is unlimited within a session. `'remote'` transactions are not
  recorded (a CRDT bridge owns their history).

### Merging

- A transaction with a `mergeKey` merges into the latest history entry only when **all** hold:
  that entry was created by a transaction with the same `mergeKey` **and the same origin**; no
  other transaction of any origin has committed since; and `history.seal()` has not been called since (the editor seals at
  pointer-up). The merged entry keeps the first `before` of every record and the latest `after`;
  a record whose merged change nets to nothing is dropped, and an entry that nets to nothing is
  removed. The label and `metaBefore` stay from the first transaction; `metaAfter` is the latest.
- There is no time window: merging never depends on the clock.

### Forks and policy

- `store.fork()` returns a store that starts from the parent's state at fork time. Writes to the
  fork never reach the parent, and later parent writes are not visible in the fork. Forking is
  O(1): parent and fork share one record map, marked shared, and **whichever of them writes
  first** copies it before writing (copy-on-write on both sides; with several forks every sharer
  copies on its first write, so no store ever writes into a map another store reads). `fork.diffFrom(parent)` gives the net diff, so a preview (AI patch, dry run)
  can be applied to the parent as one transaction.
- A fork is a preview, so it is read-write even when its parent is read-only; `diffFrom` is
  undefined for any store but the fork's own parent, so a fork cannot be applied elsewhere.
- A store created with `policy: 'read-only'` returns `err` code `TX_READ_ONLY` from every
  `transact`, and `executeCommand` returns the same diagnostic before running a command.

### Commands

- Production code calls `store.transact` only from: a command's `run(ctx, args)`, core's
  history module (`undo`/`redo`) and core's fork module (applying a fork's diff to its parent).
  M3.17's architecture test allows exactly these callers. Args are
  parsed with the command's Zod schema first; a failure, an unknown id or `when(ctx) === false`
  returns diagnostics and leaves the store untouched. A command's result is the transaction's
  `Result`.

### Consequences

- Good: undo is exact by construction (inverse diffs, no re-execution), which NFR-REL-003 tests.
- Good: undo applies only the entry's records and runs no hooks. Validation, which is on in dev
  and test, is not proportional: see the 2026-09-28 (M3.23) amendment.
- Good: plugin load order cannot change hook results; merging cannot depend on timing.
- Bad: callers must handle a `Result` from every write (commands wrap it once).
- Bad: a hook that should run on undo (none known) cannot; its effect must be in the forward diff.
- Bad: copy-on-write adds one map copy after a fork, O(n) once per fork.

### Confirmation

M3 rows cite this ADR and test it by the titles the completion gate runs: rollback
(`NFR-MNT-006: IF a put is invalid THEN the transaction SHALL roll back with diagnostics`),
hook fixed point (`FR-EXT-001: after any hook-run transaction validate reports 0 referential
errors`), merging (`FR-EDT-006: WHEN 60 merged transactions share a key THE SYSTEM SHALL create 1
history entry`), undo exactness (`NFR-REL-003: …`), forks and policy (`NFR-MNT-006: writes to a
fork never reach the parent`, `…a read-only store rejects element.update…`).

## Amendments

- 2026-09-28 (M3.11, M3.2 review F1): a nested `transact` is a savepoint. If the inner `fn`
  throws, the inner writes are dropped (earlier writes of the outer transaction are kept) before
  the exception propagates, so an outer command that catches it commits nothing half-done.
- 2026-09-28 (M3.23, M3 cp1 F3): the real cost of validation. Structural checks cover only the
  diff's records, but the referential check (`referentialErrors`) scans the whole post-state, so
  every validated transaction (undo and redo included) is O(n) in the document. Measured by the
  NFR-PERF-006 benches (`packages/core/bench`, default options, 5 000 records): about 5 ms mean
  for any of the 8 built-in commands, even `document.update`; p99 5.4–9.1 ms on the dev
  machine, within the 16 ms budget. An incremental referential check (only the records a diff
  touches and the records that reference them) is the fix if larger documents or slower machines
  exceed the budget; the bench leg of every milestone gate would show it.

## Pros and Cons of the Options

### Result-returning transactions, fixed-point hooks, strict adjacency, inverse-diff undo

- Good: meets rules 10–11, deterministic, exact undo, O(changed) cost.
- Bad: more rules to implement (net diff, merge conditions, copy-on-write).

### Throwing transactions, single-pass hooks, time-window merging, command re-execution

- Good: less code at call sites.
- Bad: exceptions for expected failures (rule 10); single-pass hooks miss cascades (a screen
  delete deletes an element whose bindings then need a pass); merging depends on the clock;
  re-executing commands on undo is neither exact nor cheap.

### Immer-style patches

- Good: fine-grained patches.
- Bad: patches are paths into nested objects, not record puts/deletes (NFR-MNT-006, CRDT bridge);
  adds a runtime dependency to the player.

## More Information

ADR-0002 (record store and signals), 03-core-engine §1–§3, M3 plan (`docs/milestones/M3.md`).
Error codes follow the convention M3.3 settles (M2 final F3).
