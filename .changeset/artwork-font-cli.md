---
"@fluxion/render": minor
"@fluxion/cli": minor
---

`fluxion render` reads `.flux` archives (ADR-0192): saved packs are opened under the shape content policy and their exact artwork fonts embedded under private aliases; missing or unloadable bytes exit 1. Render's server entry adds `embedSavedShapePacks` and the `artworkFonts` option of `renderDocumentToHtml`; the CLI's `Shot` gains an optional `evaluate` and `renderPngs` an optional list of alias families to wait for. `convert` opens saved packs under the content policy and refuses a `.flux.json` that would drop them. Migration: none for existing callers.
