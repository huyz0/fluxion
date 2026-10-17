# @fluxion/mcp

MCP server that lets an AI agent author Fluxion documents: write FluxScript, check it, lay it out, look at a screen, and save a file.
It speaks MCP over stdio, or over streamable HTTP on `127.0.0.1`. Design: [ADR-0038](../../docs/architecture/decisions/ADR-0038-mcp-server-model.md),
[docs/architecture/06-ai-authoring.md](../../docs/architecture/06-ai-authoring.md) §10.

```sh
fluxion-mcp [--root <dir>]... [--http [port]]
```

Files are read and written only under a `--root` directory; with none, the current directory is the root. Open documents are kept in memory by `docHandle`.

| Tool | Does |
|---|---|
| `list_catalog` | The shapes and kinds an agent may use |
| `compile_dsl`, `validate`, `lint` | Dry runs with diagnostics, as in the CLI |
| `create_document`, `apply_patch`, `layout` | Build and change a document held under a `docHandle` |
| `get_document_outline`, `get_screen` | Read it back as an outline or as FluxScript |
| `render_screen_png` | A PNG of one screen for the agent to look at (needs a browser; otherwise `FLX_CLI_PEER_MISSING`) |
| `save_file` | Write `.flux`, `.flux.html` or `.flux.json` under a root |

Resources: the authoring guide, the cheat sheet, the schemas, the catalog and `fluxion://examples/{name}`. Prompts: `generate_deck`, `diagram_from_description`, `animate_screen`.

Not yet built: the live link to an open studio (FR-MCP-003). A worked run is in `examples/r2-ai-deck.transcript.md`; its recordings are scripted, not from a model.
