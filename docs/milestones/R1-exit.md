# R1 exit checklist

The exit criteria of increment R1, MVP Editor & Player (`docs/requirements/01-scope-and-increments.md` §2: "Exit criteria common to every increment", and R1's
demo: *create a 5-screen deck by hand, save one `.flux.html`, reopen, present full-screen*). Each line says how it is checked; a box is ticked only when that check passes
today. `m11-complete` fails while a box is open.

## Common to every increment

- [ ] **1. Every Must requirement of R1 has a passing test that names it.** `node scripts/gates/check-trace.mjs --increment R1` exits 0. Open: **NFR-I18N-001** (all UI strings
  externalised as ICU messages, with a lint rule against JSX literals) has no test: its work is rows M9.19 and M9.20 (Lingui in the editor and studio, `check-i18n`, the conversion of the
  existing strings), which add dependencies and so a lockfile change, and that needs a `check-budget --record` from a machine whose staged ladder fits 120 s (this one takes 315 s; see M11.52
  and ADR-0156 for the same wait). NFR-SIZE-002 is named since M11.19 (`tests/harness/editor-budget.test.mjs`).
- [ ] **2. CI green on main, and the visual baselines reviewed.** The `ci` run of the last code commit must be green; the visual job compares against the baselines made in the pinned image, and
  no baseline was changed in M11 (no `Threshold-change:` trailer). Open until the last `ci` run on main is green: `node scripts/harness/last-ci.mjs`.
- [x] **3a. Changesets.** Every package M11 touched has a changeset (`.changeset/m11-*.md`; `m11-complete` checks the range).
- [ ] **3b. The user guide and the API reference.** The API reports of every touched library are current (`check-api`). Open: the user guide's "Presenting" page (`apps/docs/src/content/docs/guides/presenting.md`) does
  not exist yet (M11.26 writes it).
- [x] **4. A demo document, committed and run in CI.** `examples/r1-mvp-deck.flux.html` (M11.24), opened from `file://` offline by `e2e/examples.r1-offline.spec.ts`, checked with axe and walked with the
  keyboard; `e2e/mvp.create-save-reopen-present.spec.ts` is R1's own demo, by hand. The file holds the player of the day it was made: regenerate it with `node scripts/examples/make-r1-demo.mjs`, and
  run `make-r1-demo.mjs --check` before a release to see whether it is stale.
- [x] **5. File format changes come with a migration and a round-trip test.** M11 changed no format: `specs/format/` and `packages/schema/src/migrations/` are untouched, the lean reader of the player reads
  the same bytes (`packages/format` loader and lean tests, `tests/harness/format-spec.test.mjs`). One validation rule tightened (M11.44: a link in a document must pass `safeLinkUrl`, ADR-0025 amendment),
  which is not a format version change.

## R1-specific

- [x] **Create a 5-screen deck by hand, save, reopen, present.** `e2e/mvp.create-save-reopen-present.spec.ts` (M11.24).
- [x] **The one-file player is within budget.** `pnpm exec size-limit` holds the player core, the one-file player and the element script to `PLAYER_CORE_GZIP` (M11.18); the editor to `EDITOR_INITIAL_GZIP` and its
  time to interactive to `EDITOR_TTI_MS` through the Lighthouse job (M11.19; its green run is in `ci`).
- [ ] **NFR-SIZE-003: the 20-screen document in `.flux.html` is within its budget, or the budget is decided.** Open: the human decision of M10.45 (is the budget measured raw or gzip) is still to be made;
  until it is, `titled([['M10.45', …]])` of `m11-complete` cannot pass.
