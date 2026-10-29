# Delivery

| Row | Deliverable | Qualification |
|---|---|---|
| M18.173 | This spec, rows M18.174/M18.175/M18.176, the refined M18.17 EARS | Independent plan review |
| M18.174 | Move: member rules, session rotation (clock injected) and credits parsing/scoping from the CLI to format | CLI suites unchanged and green; format unit tests of the moved functions; API reports |
| M18.175 | `convertSvgLibrary`, `registerSvgLibrary` and the batch colors in editor | Unit tests with an injected witness and a counting `bytes()`; API report |
| M18.176 | `libraryImporter` through EditorRoot and the panel's Import SVG dialog | Component test of every dialog state with a fake importer; API report |
| M18.17 | Studio importer (browser witness, Inter, registry), pack sources kept for the save, `e2e/library.import-svg.spec.ts` | Chromium locally; Firefox/WebKit in CI; staged verify |
