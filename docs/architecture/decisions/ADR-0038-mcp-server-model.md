---
status: accepted
date: 2026-10-16
decision-makers: harness (M15.2; within FR-MCP-001/002 and ADR-0036; no requirement changes)
---

# ADR-0038 — MCP server model: document handles, file roots, transports, result shapes, image content

## Context and Problem Statement

FR-MCP-001 asks for `@fluxion/mcp`, a server that lets an agent create, inspect, patch, lint, render and save documents over stdio and streamable HTTP. ADR-0036 made the CLI's operation layer (`@fluxion/cli/ops`) the code the tools run. What is left open: how an open document is named across calls, which files a tool may touch, how the two transports are secured, what a tool returns, and how an image reaches a model that checks its own work.

## Decision Drivers

- A tool call is stateless on the wire, a document is not: later calls need a stable name for what an earlier call made.
- The server runs on a developer's machine with that user's rights; a prompt-injected agent must not read or write outside a folder the user chose (NFR-SEC).
- A tool result is read by a model: it must be small, deterministic and say what to do next, never the whole document by default.
- The tool output must equal the CLI `--json` `result` for the same input (ADR-0036), so the two cannot drift.
- Pure core: the server is the only layer here allowed `node:*`.

## Considered Options

1. **Stateless tools that take and return whole documents.** Simple, but every call pays the document in tokens and a patch cannot be told from a rewrite.
2. **Handle-based sessions in memory (chosen).** `docHandle` names an open document; the server holds its text and a revision.
3. **Persist sessions on disk.** Survives restarts but adds a store to secure and clean; an agent can re-create a document from a file.

## Decision Outcome

Option 2.

**Document handles.** `create_document` returns `docHandle`, an opaque string `doc_<n>` from a per-server counter (no clock, no randomness; deterministic transcripts). The store maps a handle to `{ text, revision, path? }`; `revision` starts at 1 and rises by one for each applied patch or replaced text. `create_document` takes exactly one of `fluxscript` (text) or `path` (a `.flux.yaml`, `.flux.json` or `.flux` file under a root), so there is no separate open tool: FR-MCP-001's eleven tools stand. A tool given an unknown handle returns an error result with code `FLX_MCP_NO_SUCH_DOC`. Handles live as long as the server process; a store holds at most 32 documents, and creating the 33rd evicts the least recently used, where every tool call naming a handle (read or write) counts as use. The eviction is reported in the creating call's `diagnostics`, and the store remembers the last 64 evicted handles, so a later call on one gets `FLX_MCP_DOC_EVICTED` (with the hint to re-create it) rather than `FLX_MCP_NO_SUCH_DOC`. Every write tool returns the new `revision`; `apply_patch` takes an optional `baseRevision` and rejects a stale one with `FLX_MCP_STALE_REVISION`, so two agents on one handle cannot overwrite each other silently.

**File roots.** The server starts with zero or more allowed roots (`--root <dir>`, repeatable; default: the working directory only). A path argument (`create_document`, `save_file`, and `path` on the dry-run tools) is resolved against the first root and must, after `realpath`, lie inside a root; otherwise the result is `FLX_MCP_PATH_OUTSIDE_ROOTS` and nothing is read or written. Symlinks that leave a root are refused. `save_file` writes through a temporary name and renames, creates no directories, and refuses to overwrite unless `overwrite: true`. Resource URIs never take a path.

**Transports.** stdio is the default (`fluxion-mcp`): stdout carries protocol frames only, logs go to stderr. Streamable HTTP (`fluxion-mcp --http [--port n]`) binds **127.0.0.1 only**, checks both headers: `Host` must be `127.0.0.1`, `localhost` or `[::1]` (with the port), and `Origin`, when present, must be `http(s)://` one of those hosts; anything else is refused with 403. The Host check is what stops DNS-rebinding, where a page's same-origin request carries no `Origin` and serves one MCP endpoint. There is no authentication in R2 because the bind is local; binding elsewhere is not offered (FR-MCP-003 owns the paired live link, M-R5).

**Tools and results.** The eleven tools of FR-MCP-001. `compile_dsl`, `validate`, `lint` and `layout` are dry runs and each takes exactly one input: `docHandle`, `fluxscript` text (`compile_dsl` accepts only text or `path`) or `path`; giving none or several is an `FLX_CLI_USAGE`-class error result. Each has a Zod input and output schema shared with `@fluxion/cli/ops` where an operation exists. A result is `structuredContent` (the `result` of the matching CLI reply, plus `docHandle`/`revision` where relevant) and a short text content that summarises it in one line; diagnostics are `Diagnostic[]` as everywhere else. `get_document_outline` returns screens, titles, slugs and counts, never raw JSON; `get_screen` returns FluxScript by default. A failed operation is a tool result with `isError: true` and the `Diagnostic[]`, never a protocol error: protocol errors are for a malformed call. Nothing a tool returns contains an absolute path outside the roots or a timestamp.

**Image content.** `render_screen_png` returns an MCP `image` content (`type: image`, `mimeType: image/png`, base64 `data`) plus a text line with the size. It needs the optional Chromium peer of ADR-0036; when absent the result is `isError` with `FLX_CLI_PEER_MISSING` and the install hint. Width is capped (default 1280, max 2048) so a result stays under a few hundred KB.

**Resources and prompts.** Six resource URIs and three prompts (FR-MCP-002) are generated from the same sources as `llms.txt` (grammar schema, `codes.ts`, the catalog, the examples), so they cannot drift from the code.

### Consequences

- Good: an agent edits by small patches against a named document; a transcript is replayable.
- Good: path safety is one function with one failure code, tested by traversal and symlink cases.
- Good: tool results and CLI replies share schemas.
- Bad: handles die with the process; an agent must re-open the file after a restart.
- Bad: no HTTP authentication until the live link; mitigated by the loopback bind and origin check.
- Good: the new codes `FLX_MCP_NO_SUCH_DOC`, `FLX_MCP_DOC_EVICTED`, `FLX_MCP_STALE_REVISION` and `FLX_MCP_PATH_OUTSIDE_ROOTS` are registered in `@fluxion/schema` and listed in `docs/reference/diagnostics.md` in M15.7, like every other code.
- Bad: a new runtime dependency, `@modelcontextprotocol/sdk` (licence checked in M15.7).

### Confirmation

M15.7 (in-memory and stdio listing; the four codes registered), M15.8 and M15.9 (`tools-read.test.ts`, `tools-write.test.ts`: handles, revisions, roots, traversal), M15.10 (`http.test.ts`: loopback and origin; `render_screen_png` image content), M15.11 (`inspector.test.ts`: 11 tools, 6 resource URIs, 3 prompts).

## More Information

ADR-0036 (operation layer), 06-ai-authoring.md §10, FR-MCP-001, FR-MCP-002, FR-MCP-003, NFR-SEC-004.
