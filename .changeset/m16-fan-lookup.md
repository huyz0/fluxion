---
'@fluxion/routing': patch
---

Finding a connector's parallel siblings reads the bindings of whichever end has fewer, so the 200 spokes of a hub no longer each read all of the hub's bindings. Dragging a hub with 200 connectors is several times faster.
