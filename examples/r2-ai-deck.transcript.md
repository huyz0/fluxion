# R2 demo: a scripted MCP session

This is a **scripted** transcript, not a recording of a model. The calls below are what an agent connected to `fluxion-mcp` makes to
build `r2-ai-deck.flux.yaml` and fix it with a patch; the replies are the server's real replies, replayed and compared by
`packages/mcp/src/e2e/r2-demo.test.ts` on every run (so this file cannot drift from the server). The transcripts of Claude Code and
Codex driving the same server are a Deferred human step (they need a live model).

Each step is `call:` the tool and its main argument, then `reply:` the first line the server sends back.

1. call: `compile_dsl` with the FluxScript of `r2-ai-deck.flux.yaml`
   reply: `10 screens, 116 records`
2. call: `create_document` with the same FluxScript
   reply: `opened doc_1`
3. call: `lint` of `doc_1`
   reply: `score 100, 0 findings`
4. call: `get_document_outline` of `doc_1`
   reply: `10 screens`
5. call: `apply_patch` to `doc_1`, adding the node `step4` ("4. Tell us what you built") to the screen `next`
   reply: `1 ops applied`
6. call: `lint` of `doc_1`
   reply: `score 100, 0 findings`

Build the page with the CLI: `node packages/cli/dist/bin.js render examples/r2-ai-deck.flux.json -o r2-ai-deck.html` after
`fluxion compile examples/r2-ai-deck.flux.yaml -o examples/r2-ai-deck.flux.json`; CI builds it and uploads it as the `r2-ai-deck-demo` artifact.
