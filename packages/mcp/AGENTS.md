# @fluxion/mcp — agent notes

MCP server exposing the same operations as the CLI to AI agents.

## Rules

- Layer L5: import only from lower layers (docs/architecture/01-overview.md); enforced by `check-layering`.
- Node runtime (>= 22). Keep command logic in shared `ops` so the MCP server and CLI stay identical.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
