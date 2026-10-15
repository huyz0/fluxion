---
'@fluxion/editor': minor
'@fluxion/studio': minor
---

M13.30, Arrange off the main thread in the studio (FR-LAY-007): `EditorRoot` takes an `arrange` runner (`ArrangePort`); with one, the Arrange commands return at once, show "Arranging…" and then clear it or say why the layout failed, and only the newest request speaks. The studio runs them in a layout worker (`layout.worker`, its own build chunk) through `createAsyncArranger`, one undo step each; without a runner the commands run on the spot as before.
