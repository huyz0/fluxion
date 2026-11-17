---
"@fluxion/theme": minor
"@fluxion/sdk": minor
"@fluxion/editor": minor
---

Theme files and theme packs (FR-THM-007, ADR-0055). `exportDtcg(theme)` writes a theme as a DTCG theme file (`<name>.tokens.json`, named by `themeFileName`): colours as DTCG colour objects (the original CSS text kept in `dev.fluxion.css` when the object does not rebuild it), shadow lengths as px dimensions, and the name, defaults and table styles under the root `$extensions["dev.fluxion"]`. `importDtcg` reads such a file back to a deep-equal theme (`DTCG_INVALID` otherwise), and `themesFromFiles(packId, files)` gives a pack's themes from its files; the SDK re-exports all three. The editor's `themeChoices(registry)` lists every registered pack's themes for the theme switcher, and choosing a theme now copies its table styles too.
