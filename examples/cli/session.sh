#!/usr/bin/env bash
# The authoring loop an agent runs: write FluxScript, compile, lint, score the layout, patch, export.
# Run from the repository root after `pnpm run build`. Every step prints one --json reply; the exit code says what to do next.
set -euo pipefail
FLUX="node packages/cli/dist/bin.js"
OUT="$(mktemp -d)"

$FLUX compile examples/dsl/edge-ops.flux.yaml -o "$OUT/deck.flux.json" --json | head -c 300; echo
$FLUX lint "$OUT/deck.flux.json" --min-score 80 --json | head -c 300; echo
$FLUX layout "$OUT/deck.flux.json" --score
# a patch targets screens by slug: this small deck has one called main
printf 'flux: 1\ntitle: Base\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect }\n' > "$OUT/base.flux.yaml"
$FLUX compile "$OUT/base.flux.yaml" -o "$OUT/base.flux.json"
$FLUX patch "$OUT/base.flux.json" fixtures/patches/add-node.patch.json -o "$OUT/patched.flux.json"
$FLUX decompile "$OUT/patched.flux.json" -o "$OUT/flow.mmd" --format mermaid
$FLUX decompile "$OUT/patched.flux.json" -o "$OUT/back.flux.yaml"
echo "wrote $OUT"
