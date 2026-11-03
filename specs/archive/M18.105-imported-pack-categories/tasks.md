# Delivery

| Row | Deliverable | Qualification |
|---|---|---|
| M18.43 | This spec, rows M18.210/211/212, M18.105 re-scoped as their umbrella | Independent plan review |
| M18.210 | Editor convertIconifyLibrary/convertDrawioLibrary, panel Import Iconify…/draw.io… entries, studio sources kept, e2e save and reopen | Unit and component tests; e2e Chromium locally, Firefox/WebKit in CI; staged verify |
| M18.211 | ADR-0210, pack format 1.2 (optional category `name`), encoder/parsers/subset/embed, v1.2 fixtures, api reports | Format and core tests; first-party goldens unchanged; staged verify |
| M18.212 | Panel category and pack labels from the index, live and after reopen | Component test; e2e extends M18.210's spec with the label after reopen |
| M18.105 | Closed when M18.210–212 are done (umbrella; no own commit) | — |
