---
'@fluxion/editor': minor
'@fluxion/studio': patch
---

The Source view applies the text as a three-way merge (ADR-0032): only what the author changed since the text was last generated or applied is written, so a canvas change the text does not mention stays (a pin, a layer name) and an element the text cannot say (an image, a frame) survives an apply. A field both changed is written from the text and named in the status line ("Overwrote canvas changes to: …"). A slug renamed in the text is one id remap, not a delete and an add: the record keeps its canvas fields, and every record that pointed at it (bindings, comments, interactions, steps, kept children) follows. Records made by hand, whose ids are random, are remapped to the ids their slugs derive on the first apply. A comment, interaction, step or binding that pointed at an element the text deleted is removed or cleaned in the same undo step, and counted in the status line. After an apply the canvas is ahead of, the banner offers the reload. The studio's test hooks gain `records` and `applyRecords`.
