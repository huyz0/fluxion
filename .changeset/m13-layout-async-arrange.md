---
'@fluxion/layout': minor
---

M13.29, Arrange off the main thread (FR-LAY-007, FR-LAY-005): `createAsyncArranger({ store, execute, host, lookup })` snapshots on the caller, lays a flat plan out in a worker through the layout host and writes the boxes with the new command `layout.applyBoxes` (`APPLY_BOXES_COMMAND_ID`, registered by `registerArrangeCommand`) as one undo step; a plan with nested containers runs on the caller through `layout.arrange`. It refuses, writing nothing, when the screen changed while the worker ran. `LayoutHost`, `HostJob` and `AbortSignalWithEvents` are also exported from the main entry.
