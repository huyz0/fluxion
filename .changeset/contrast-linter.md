---
"@fluxion/theme": minor
"@fluxion/dsl": minor
"@fluxion/editor": minor
---

Contrast linter (NFR-A11Y-005). theme's `checkContrast({ kind, color, against })` measures a colour at its WCAG AA target (text 4.5:1; large text and strokes 3:1, the palette generator's thresholds) and gives the nearest passing colour (same hue and chroma, nearest lightness); `textContrastKind` and `contrastTarget` name the kind and target. dsl's CONTRAST rule now uses it, reads text with no fill against the theme's background, and also checks the outline of connectors and unfilled elements; `contrastIssues(element, theme)` lists an element's issues. The editor's Problems panel offers Fix contrast, which sets the failing colour to the nearest passing one in one undo step.
