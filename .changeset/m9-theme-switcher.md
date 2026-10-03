---
'@fluxion/render': minor
'@fluxion/editor': minor
'@fluxion/studio': minor
---

Screens are drawn with their own theme (`screen.themeId`), else the document's, else the light theme (`useScreenTheme`); the editor toolbar gains a theme switcher and a per-screen override over the themes the host offers (`ThemeSwitcher`, `EditorRoot` `themes`); the studio bundles the themes-core pack (FR-THM-004).
