# M18.157 — Cold setup without coverage

Requirements: NFR-DX-001 (wording changed), NFR-MNT-004 (unchanged). Decision: ADR-0216, the coordinator's of
2026-11-05 07:12Z under Huy's delegation of 2026-11-04 13:34:57Z; kept under his full delegation of 2026-11-05 11:04:52Z (cp25 F4, cp46 F1).

Why: the cold setup has run over COLD_SETUP_MAX_MS (600 s) since M18.117 (807.5 s at 7989d10). The diagnostic review
(ADR-0176, attempt 3) found cuts that keep coverage in the cold setup reach about 100–130 s of the 200 s needed.

Scope: NFR-DX-001's cold setup measures `pnpm verify --no-coverage`; the verify jobs keep `pnpm verify` with coverage;
the review's harness cuts; the browser project three files wide on Linux, after the node project.

Not in scope: COLD_SETUP_MAX_MS, any coverage floor, the staged pre-commit's coverage, `isolate: false`, closing
M18.157 (after three consecutive main runs within the limit, with budget.json recorded --cold-from-ci).
