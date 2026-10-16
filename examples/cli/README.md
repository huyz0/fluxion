# CLI session

`session.sh` runs the authoring loop of `docs/architecture/06-ai-authoring.md` §9 over `examples/dsl/edge-ops.flux.yaml`:
compile, lint, `layout --score`, apply a patch, then export a Mermaid flowchart and FluxScript. It writes into a temporary directory.
