# Tasks

- M18.157 (this row, attempt 3): the change above in one commit with ADR-0216 and the NFR-DX-001 wording. The row stays
  open until three consecutive main cold-setup runs finish within COLD_SETUP_MAX_MS; its closing commit records
  budget.json with --cold-from-ci.
- M18.284 (cp46 F1, cp47 F2): an independent plan review of this folder (code-review --kind plan), against ADR-0216 and
  NFR-DX-001's `pnpm verify --no-coverage` wording, recorded as M18.284's digest line. A changes-requested verdict reopens
  M18.157.
- Closed: attempt 4 (c8d8792; one packing for publint and attw, one API Extractor program) after a fresh diagnostic
  review; main read 512 s, 581 s and 434 s; budget.json recorded --cold-from-ci from ci 42306748397. The living record is
  ADR-0216 (Consequences) and docs/standards/ci-cd.md §4 (Cold setup).
