# R1 exit checklist

The exit criteria of increment R1, MVP Editor & Player (`docs/requirements/01-scope-and-increments.md` §2: "Exit criteria common to every increment", and R1's
demo: *create a 5-screen deck by hand, save one `.flux.html`, reopen, present full-screen*). Each line says how it is checked; a box is ticked only when that check passes
today. `m11-complete` fails while a box is open.

## Common to every increment

- [x] **1. Every Must requirement of R1 has a passing test that names it.** `node scripts/gates/check-trace.mjs --increment R1` exits 0 ("338 requirements, 123 named by tests, every Must of R1 covered"). NFR-I18N-001 (all UI strings
  externalised as ICU messages, with a lint rule against JSX literals) is met: rows M9.19, M9.20, M11.71, M11.72, M11.75 and M11.76 are done, `scripts/gates/i18n-allowlist.json` has no entries, `check-i18n` and the catalog check
  (`scripts/i18n/extract.mjs --check`) are steps of the staged ladder, `m11-complete` re-checks them, and `e2e/i18n.studio-build.spec.ts` shows the translated text on the studio's production build. NFR-SIZE-002 is named since M11.19 (`tests/harness/editor-budget.test.mjs`).
- [x] **2. CI green on main, and the visual baselines reviewed.** The `ci` run of the last code commit must be green; the visual job compares against the baselines made in the pinned image, and
  no baseline was changed in M11 (no `Threshold-change:` trailer). Met: the `ci` run 37497697812 at b8ab3ec is green, as `node scripts/harness/last-ci.mjs` reports; the code commits after e8fad47 (M11.79 to M11.86: the nightly's trace upload and clipboard probe, the editor's clipboard chord fallback M11.82, the lockfile overrides M11.84) are in that run, and only documentation follows it (4fb0b96). The `gates` run 37574909448 at 4fb0b96 is green. The visual baselines are the pinned image's; none changed in M11.
- [x] **3a. Changesets.** Every package M11 touched has a changeset (`.changeset/m11-*.md`; `m11-complete` checks the range).
- [x] **3b. The user guide and the API reference.** The API reports of every touched library are current (`check-api`), and the guide "Presenting" (`apps/docs/src/content/docs/guides/presenting.md`, M11.61) says how to present, move, share a link and embed.
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
- [x] **NFR-SIZE-003: the 20-screen document in `.flux.html` is within its budget.** Decided by the human on 2026-10-05: the budget is 450 kB gzip (ADR-0157); `e2e/file.size.spec.ts` measures the page made from `fixtures/docs/doc20.flux.json` (about 241 kB gzip).
