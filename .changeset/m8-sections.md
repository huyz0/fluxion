---
'@fluxion/schema': minor
'@fluxion/core': minor
---

Schema 1.1 (ADR-0021): the `section` record (`name`, `index`, `collapsed?`) and the reference check that `screen.sectionId` names one; the migration 1.0 → 1.1 drops the dangling `sectionId` a 1.0 screen carried. Also `SCREEN_PRESETS` and `presetOf`, and the screen commands `screen.rename`, `screen.setHidden`, `screen.setFormat` and `screen.duplicate`, and the section commands `section.create`, `section.rename`, `section.setCollapsed`, `section.reorder`, `section.delete` and `screen.setSection`, in core.
