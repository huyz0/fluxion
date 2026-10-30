---
"@fluxion/format": minor
"@fluxion/editor": minor
"@fluxion/cli": minor
"@fluxion/studio": minor
---

Subset fonts on save. The studio's assistant settings gain "Subset embedded fonts to the text they draw when saving" (off by default), and `fluxion convert <in> <out> --subset-fonts` does the same for a `.flux` or a `.flux.html`, reporting each font in `--json` under `result.fonts`. Each font is cut in its own worker, the written copy must reopen intact, and any font that may not or cannot be cut is written whole with a reason. A subset font's asset record names the whole font it came from in `font.subset` (ADR-0201). The subset engine and its pinned modules now live in `@fluxion/format` (moved from `@fluxion/editor`).
