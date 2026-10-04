---
status: accepted
date: 2026-10-04
decision-makers: harness (M10.2; within FR-FIL-007, NFR-REL-001 and architecture/08-file-format.md §7; no runtime dependency for the player)
---

# ADR-0024 — Autosave storage: an IndexedDB journal, OPFS for bytes and snapshots, a Web Lock per document

## Context and Problem Statement

FR-FIL-007 asks for autosave to local browser storage with crash recovery and version snapshots; NFR-REL-001 caps the
delay at 5 s after a change. architecture/08 §7 sketches the shape (a journal in IndexedDB, bytes in OPFS, the last 20
snapshots) but leaves open the journal's schema, whether to use a wrapper library, what a second tab does, and what
happens when storage is full, evicted or missing (private windows, Safari's limits). M10.18 builds it; this decides it
before any code.

## Decision Drivers

- Work is never lost silently: a failed write is shown, never swallowed.
- The editor's undo is record-diff based (ADR-0002), so the journal records what the store already produces.
- A browser kill must leave a state the next open can read: writes are small, ordered and idempotent.
- No dependency the standard does not need; the player has no autosave and takes nothing.
- The whole thing is testable with an injected clock and an in-memory port (tests may not use real timers in pure
  packages; the studio adapter takes the clock as a parameter).

## Considered Options

1. **Raw IndexedDB with a small wrapper of ours.** About 150 lines; no dependency; the schema is ours.
2. **`idb`** (ISC, 1 kB). A nicer promise API over the same thing; a runtime dependency for a wrapper we can write.
3. **OPFS only** (`createSyncAccessHandle` in a worker, a log file per document). Fast for large writes but not
   available the same way in every engine's private mode, and a torn log file needs its own framing.
4. **`localStorage`.** Synchronous, 5 MB, strings only: no.

## Decision Outcome

Option 1 for the journal, OPFS for bytes and snapshots, with a memory fallback that says so.

- **Database.** `fluxion-autosave`, version 1, with three object stores. `docs` (key `docId`): `{ docId, title, savedRev,
  headRev, updated, checkpointSeq }`. `journal` (key `[docId, seq]`): `{ docId, seq, rev, at, puts, deletes }`: `puts` is
  the list of records written (`{ id, after }`, the whole record after the change, added and changed alike) and
  `deletes` the ids removed. A store `Diff` (`packages/core/src/transaction.ts`, maps of puts and deletes carrying
  `before` and `after`) has no serialised form today, so M10.18 adds `encodeDiff` and `replay` to `@fluxion/format`: `before`
  is dropped (replay needs only `after`), records are written in canonical JSON, and an entry replays by put and
  delete in order. `checkpoints` (key `docId`): `{ docId, seq, records }`, the full record set at `seq`. A schema change is a
  new database version with an `onupgradeneeded` step and a fixture test; nothing is ever dropped on upgrade.
- **Writing.** Diffs accumulate and are put in one transaction after a 2 s debounce (`AUTOSAVE_DEBOUNCE_MS = 2000`); the
  budget is 5 s from the change to a committed transaction. The pending diffs are also flushed on `visibilitychange` to
  hidden and on `pagehide`. When the journal for a document passes 200 entries or 2 MB, the next write compacts it: a
  checkpoint of the current records is written and the entries up to it are deleted in the same transaction. An
  explicit save sets `savedRev` to `headRev`.
- **Recovery.** On open, `headRev > savedRev` means unsaved work: the checkpoint plus the entries after its `seq`, replayed
  in order, rebuild the records; the studio offers "Recover unsaved changes" with a preview and a discard. The rebuilt
  document goes through the loader's validate and repair steps like any other; a journal that does not replay (a torn
  entry) recovers up to the last entry that does and says what it dropped.
- **Bytes.** Asset bytes live in OPFS at `assets/<sha256>` (content-addressed, so a duplicate is one file, FR-FIL-004);
  where OPFS is absent they go to an `assets` object store of the same database, and the status line says storage is
  reduced. Reading an asset the document refers to but the store lacks is a repairable gap (the loader names it), not a
  crash.
- **Snapshots.** On each explicit save and after every 10 minutes of editing with changes, a full `.flux` is written to
  OPFS `versions/<docId>/<iso>.flux`; after each write the oldest beyond 20 are removed (`VERSION_SNAPSHOTS = 20`).
  Where OPFS is absent there are no snapshots, and the status line says so.
- **Two tabs.** Each document is edited under a Web Lock named `fluxion:doc:<docId>` (`navigator.locks.request`,
  `ifAvailable`, held for the editor's lifetime). A tab that does not get it opens the document read-only with a banner
  ("open in another tab") and offers to take over only after the other tab releases. Where Web Locks is absent the
  document is edited without a lock and the banner says autosave from two tabs could conflict; a `BroadcastChannel`
  heartbeat is not added in M10.
- **Quota, eviction and failure.** The studio asks `navigator.storage.persist()` on the first save and reads
  `navigator.storage.estimate()` before a write that is more than 10 % of the remaining quota. A `QuotaExceededError`,
  any failed transaction, or a missing database (private mode) sets an "Autosave unavailable: save the file" status that
  stays visible, keeps the diffs in memory, and tries again on the next change. A failed write is retried by a backoff
  timer (1 s, 2 s, 4 s, then every 30 s, through the injected `setTimeout`), not only on the next change, so a quiet tab
  still reaches storage once it has room; the 5 s budget (NFR-REL-001) is measured from the change to the first
  successful write. Eviction clears the whole origin (IndexedDB, OPFS and
  `localStorage` together), so nothing stored in the browser can report that it happened. The ADR therefore does not claim
  to detect it. Where `persist()` is granted the browser does not evict, and the status line says "Autosave is
  protected". Where it is denied or absent the status line says, from the first save on and for as long as it stays denied,
  "The browser may clear autosave: save the file", with a Save button; the recovery prompt cannot offer what eviction took.
  The version snapshots and the journal are a convenience on top of saving the file, not a replacement for it.
- **Where it lives.** The journal and snapshot logic sit behind an `AutosaveStore` port in `apps/studio` (a thin IndexedDB
  and OPFS adapter) with an in-memory adapter for tests; the scheduling takes `now`, `setTimeout` and `clearTimeout`
  as parameters. The diff format, replay and the checkpoint rule are pure and live in `@fluxion/format`, so the CLI can
  read a journal export later.

### Consequences

- Good: no new dependency; every failure mode that the page can see has a visible status; the journal replays through the same validation as
  a file; two tabs cannot interleave journal entries where Web Locks exists.
- Good: the crash-recovery E2E (kill the context, reopen, recover) needs only the real IndexedDB and OPFS of the engine
  under test, and the unit tests need only the in-memory port.
- Bad: raw IndexedDB is verbose; a small wrapper and its tests are ours to keep.
- Bad: Safari's storage limits and Firefox private mode reduce what autosave can promise, and eviction of an origin
  without a persist grant cannot be detected after the fact; the status line states the risk up front rather than
  hiding it.
- Neutral: version history beyond 20 snapshots and a visual diff are FR-EDT-023 (R8).

### Confirmation

- A browser test per engine writes, reads and compacts the journal against the real IndexedDB; one fills the quota
  (a stub that throws `QuotaExceededError`) and sees the status and the in-memory retry.
- `e2e/file.crash-recovery.spec.ts` (M10.18): an edit made 5 s before the context is killed comes back; so do the
  details-dialog metadata and `modified` (M9.18).
- A snapshot test keeps exactly 20 versions after 25 writes; a lock test opens a second tab read-only.
