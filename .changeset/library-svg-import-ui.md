---
"@fluxion/editor": minor
---

`svgWitnessStarter(options)` gives `convertSvgLibrary` its `startWitness` from the renderer's paint witness in the host's document, one bounded session per call (M18.17). The Import SVG dialog clears an earlier credits file as soon as another is picked and says when the new one is read, so a convert never runs under credits no longer shown; the dialog stacks above the canvas. Migration: none.
