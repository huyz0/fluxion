---
"@fluxion/core": minor
"@fluxion/render": minor
"@fluxion/editor": minor
"@fluxion/cli": patch
---

Master screens draw (FR-SCR-005, ADR-0054). Core adds `appliedMaster`, `masterLayers`, `dependentsOf`, `placeholdersOf`, `strayFills`, `sharedPlaceholderNames` and `isMasterScreen` (types `AppliedMaster`, `MasterLayers`, `MasterProblemCode`). Render draws a screen's applied master beneath its own elements in edit, present and export (its background and theme unless the screen has its own, its elements unless `hideMasterElements`, never its placeholders), an unfilled placeholder as a dashed hint in edit mode only (`ModePolicy.placeholderHints`), and leaves master screens out of `screensInOrder` and `presentationOrder` (new `mastersInOrder`, `useMasterLayers`; `useScreenTheme` takes the master's theme). The editor lists masters in their own navigator section and reports master problems; `fluxion render --screen` refuses a master. Migration: none.
