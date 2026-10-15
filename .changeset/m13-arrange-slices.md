---
'@fluxion/layout': minor
'@fluxion/editor': patch
'@fluxion/studio': patch
---

M13.31, a 500-element Arrange in short writes (FR-LAY-007): `createAsyncArranger` takes `slice` and `pause` and writes the boxes in slices of that size with the thread given back between them, all one undo step (a merge key); it checks that the document did not change while the worker ran by subscribing to the store instead of reading the snapshot twice, and gives the thread back once before its snapshot so the notice is drawn first. The studio writes 8 boxes per slice. The editor's notice is a signal only the notice component reads, so a message that comes and goes does not draw the whole editor again.
