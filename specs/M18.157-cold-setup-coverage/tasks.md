# Tasks

- M18.157 (this row, attempt 3): the change above in one commit with ADR-0216 and the NFR-DX-001 wording. The row stays
  open until three consecutive main cold-setup runs finish within COLD_SETUP_MAX_MS; its closing commit records
  budget.json with --cold-from-ci.
- M18.284 (cp46 F1, cp47 F2): an independent plan review of this folder (code-review --kind plan), against ADR-0216 and
  NFR-DX-001's `pnpm verify --no-coverage` wording, recorded as M18.284's digest line. A changes-requested verdict reopens
  M18.157.
