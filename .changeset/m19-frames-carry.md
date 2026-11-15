---
'@fluxion/core': minor
'@fluxion/editor': minor
'@fluxion/layout': patch
---

Frames carry and reparent their children (ADR-0052). Core adds `frameTurned` and `frameFlipped` (a frame's members turn and mirror with it, a turned frame flipping across its own centre line), `frameDropTarget` and `dropReparents` (an element dropped with its centre in a frame joins it, one dragged out of its frame joins the frame's container; a drop into a live frame lets its layout place the element). The select tool's resize handle now changes a frame's box alone, leaving its members where they are (a group still scales its members), and a drag's drop reparents in the same undo step. A frame's `padding` is its layout's inset when the layout names none.
