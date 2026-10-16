---
'@fluxion/core': minor
'@fluxion/schema': minor
'@fluxion/dsl': minor
'@fluxion/layout': minor
'@fluxion/routing': minor
'@fluxion/cli': minor
'@fluxion/pack-basic': minor
---

M14.6, the AI catalog (FR-AI-002): `buildCatalog(registries, { pack?, detail })` in `@fluxion/dsl` lists shapes, route types, markers, layouts, themes, effects and transitions with a one-line `describe` and the registering plugin. `describe` is a new optional field of `ShapeDef`, `MarkerDef`, `Router` and `LayoutAlgorithm`; `createCoreRegistries({ requireDescribe: true })` makes a dev host refuse an entry without one (`FLX_REGISTRY_UNDESCRIBED`). Every built-in shape, marker, router and layout now has a describe line. The CLI host registers the built-in layouts and route types.
