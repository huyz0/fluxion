---
"@fluxion/geometry": minor
"@fluxion/core": minor
"@fluxion/editor": minor
---

Boolean operations (FR-SHP-010, ADR-0053). Union, Subtract, Intersect and Exclude on the element menu combine the selected shapes into one path shape in one undo step; connectors bound to them move to the result. Geometry adds `booleanPaths` and `booleanPlacement` (pure, the same bytes in every engine), built on polybooljs; core adds the `shape.boolean` command; the editor adds `combineSelection` and its four commands.
