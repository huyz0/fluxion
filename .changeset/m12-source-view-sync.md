---
'@fluxion/editor': patch
'@fluxion/studio': patch
---

The Source view follows the canvas (FR-EDT-022, ADR-0032): a canvas edit regenerates the screen's FluxScript while the view is clean and not focused; a focused or dirty view keeps its text and shows a "Canvas changed — reload" banner whose button replaces it; blur applies the waiting text at once. The studio's test hooks gain `pinElement`.
