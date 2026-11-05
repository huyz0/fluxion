# Tasks

- M18.157 (this row, attempt 3): the change above in one commit with ADR-0216 and the NFR-DX-001 wording. The row stays
  open until three consecutive main cold-setup runs finish within COLD_SETUP_MAX_MS; its closing commit records
  budget.json with --cold-from-ci.
