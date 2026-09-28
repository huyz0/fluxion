---
status: accepted
date: 2026-09-29
decision-makers: Fluxion maintainers (M4 plan row 10, delegated to the driver)
---

# ADR-0147 — CLI v0: command shape, exit codes and the `--json` envelope

## Context and Problem Statement

M4 ships the first `fluxion` commands, `validate` and `render` (FR-CLI-001). Agents will read the
CLI's `--json` output long before the full command set of FR-CLI-002 (R2), and the MCP server
(M15) must return the same shapes. `--json` output is a contract (AGENTS.md non-negotiable 6). So
what shape does it take, which exit codes mean what, and how are arguments parsed?

## Decision Drivers

- Agents branch on a machine-readable result, never on text (FR-CLI-002: `--json` schema-stable).
- One diagnostic shape across schema, core, CLI and MCP: the schema's `Diagnostic` with a JSON
  pointer `path` (FR-DOC-004).
- Exit codes an agent or CI can rely on without parsing (FR-CLI-005, adopted early).
- No runtime dependency for argument parsing (Node ≥ 22 has `node:util.parseArgs`).

## Considered Options

- **A.** The contracts standard's reply (`apiVersion`, `ok`, `result` or `errors[]`), one Zod
  schema per command, generated JSON Schema snapshots.
- **B.** Per-command free-form JSON, documented in prose.
- **C.** A CLI framework (commander, yargs) and its conventions.

## Decision Outcome

Chosen option **A**.

1. **Commands**: `fluxion <command> [options] [args]`. Arguments are parsed with
   `node:util.parseArgs` in strict mode, per command. `--help`/`-h`, `--version` and `--json` are
   global. The command table lives in `packages/cli/src/main.ts`, and `run(argv, io)` returns the
   exit code, so tests run it in-process as well as through the built `dist/bin.js`.
2. **Exit codes** (FR-CLI-005): `0` success; `1` the input has errors (validation diagnostics);
   `2` usage error (unknown command, unknown or malformed option, missing argument); `3` internal
   error (an exception, or a command not yet available).
3. **`--json` reply** (docs/standards/contracts.md §6 rule 13): one JSON object on stdout,
   nothing else on stdout. Success: `{ "apiVersion": 1, "command": <name or null>, "ok": true,
   "exitCode": 0, "result": {…} }`; failure: `{ "apiVersion": 1, "command", "ok": false, "exitCode":
   1-3, "errors": [Diagnostic…] }`. A `Diagnostic` is the schema's (`code`, `severity`, `path` as
   a JSON pointer, `message`, optional `hint`). Help and the version are results too
   (`{ "help" }`, `{ "version" }`). Human messages go to stderr in both modes.
4. **Schemas** (contracts.md §1 and rules 1, 6, 15): the reply of each command is a Zod schema in
   `packages/cli/src/output.ts`; `run` parses every reply with it before printing (a reply outside
   its schema is reported as an internal error). The snapshots
   `packages/cli/schemas/<command>.output.json` (`fluxion` for the reply without a command) are
   generated from those schemas with `z.toJSONSchema` and compared by `output.test.ts` (Vitest file
   snapshots, rewritten with `vitest -u`); the MCP tools (M15) reuse the same Zod schemas.
5. **Diagnostics**: usage errors are `FLX_CLI_USAGE` (error), listed in
   `docs/reference/diagnostics.md` like every other code.

### Consequences

- Good, because agents, CI and the MCP server share one shape and one set of exit codes.
- Good, because no dependency is added for parsing.
- Bad, because `parseArgs` has no subcommand help generation: help text is written by hand in the
  command table.
- Neutral: `apiVersion` changes only with a new ADR (contracts.md rule 3); adding a command or a
  result field is additive (minor).
- The M4 plan's first wording put a hand-written schema in `specs/cli/`; the contracts standard's
  location and generation rule apply instead (M4.17 review F1), and the plan row and the M4 gate
  name `packages/cli/schemas/`.

### Confirmation

`packages/cli/src/main.test.ts` and the e2e suites under `packages/cli/src/e2e/` (spawning
`dist/bin.js`) check the exit codes and parse `--json` replies with their schemas;
`output.test.ts` keeps the generated snapshots equal to the schemas; the M4 completion gate requires
`packages/cli/schemas/*.output.json`.

## More Information

FR-CLI-001, FR-CLI-002, FR-CLI-005; ADR-0015 (the render command's HTML); 06-ai-authoring (agents
use the CLI and MCP).
