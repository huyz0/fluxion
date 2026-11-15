---
"@fluxion/schema": minor
"@fluxion/core": minor
"@fluxion/editor": minor
"@fluxion/cli": patch
"@fluxion/studio": patch
---

Master screens are edited (FR-SCR-005, ADR-0054). Schema adds `isMasterScreen` (core re-exports it). Core adds the commands `screen.setRole` (a master, or an ordinary screen again: its screens lose it and their fills of its placeholders), `screen.setMaster` (a master given, with its size, or taken away, clearing that screen's fills), `element.setPlaceholder` and `element.fillPlaceholder` (a copy of the placeholder on the screen, filling it); `nextVisibleScreen` skips masters. The editor's navigator menu makes a screen a master, uses a master or none; the element menu makes a master's element a placeholder or an ordinary element; a double-click on a placeholder hint fills it; Edit master and Close master switch to and from the shown screen's master; presenting from the shown screen while a master is shown starts at the first slide. `fluxion` outline (and MCP `get_document_outline`) omits masters, its JSON shape unchanged, while a master's text is still given by id; the studio library thumbnail skips masters and draws a slide's master behind it. Migration: none.
