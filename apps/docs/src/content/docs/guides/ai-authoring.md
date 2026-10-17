---
title: Authoring with AI
description: Let an agent write a deck over MCP, or ask the studio's AI panel to change the one you have open.
---

There are two ways to have an AI work on a document. Both go through the same checks: whatever a model writes is compiled, validated and linted before you see it.

## From an agent, over MCP

`fluxion-mcp` is an MCP server. Point your agent's MCP configuration at it, and give it the folders it may write to:

```sh
node packages/mcp/dist/bin.js --root ./decks
```

The agent can then read the catalog, write FluxScript with `create_document`, fix what `lint` reports, look at a screen with `render_screen_png`, and write the file with `save_file`.
It can only touch files under a `--root`. Add `--http` to serve on `127.0.0.1` instead of stdio. A sample run is in `examples/r2-ai-deck.transcript.md`; its replies are scripted, not recorded from a model.

## From the studio

The AI panel takes a request, shows the change as a preview on a copy of your document, and applies it only when you accept. An applied change is one undo step.
Provider keys are kept in your browser's IndexedDB and are never written to a file, a log or a diagnostic report.

## Importing

Mermaid diagrams and Markdown outlines become FluxScript. Syntax the importers do not read is reported, not dropped without a word.
