# @fluxion/cli — agent notes

The fluxion command: validate, compile, render, lint, layout, convert, catalog, pack, site build.

## Rules

- Layer L5: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- Node runtime (>= 22). Keep command logic in shared `ops` so the MCP server and CLI stay identical.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.

## Invariants (M4)

- `--json` replies follow docs/standards/contracts.md §6 and ADR-0147: one object on stdout, `{ apiVersion, command, ok, exitCode }` plus `result` (ok) or a non-empty `errors[]`; each reply is parsed by its Zod schema in `src/output.ts` before printing, and `schemas/<command>.output.json` is generated from it (`output.test.ts`, `vitest -u`).
- Exit codes: 0 ok, 1 input errors (`FLX_CLI_IO` for unreadable or unwritable files), 2 usage (`FLX_CLI_USAGE`), 3 internal (`FLX_CLI_INTERNAL`).
- Human text goes to stderr in both modes; stdout holds only the reply or the requested output (help, version).
- Commands live in their own modules (`validate.ts`, `render.ts`) over shared helpers (`command.ts`), so the MCP server (M15) can reuse them; e2e suites under `src/e2e/` spawn the built `dist/bin.js`.
