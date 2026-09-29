# @fluxion/sdk

The public plugin API: the stable contracts plugins and packs build on, re-exported from the
packages that own them, plus pack definition. First-party packs (`packs/*`) import only this.

| Layer | Pure | Status |
|---|---|---|
| L4 | no | M5: packs of shapes and markers |

## Packs

`definePack({ id, shapes, markers })` defines a pack: a namespace of shape definitions
(`ShapeDef`, ADR-0016) and connector end markers (`MarkerDef`). Nothing registers until a host calls
`pack.register(registries)` with its core registries (ADR-0017). Everything is checked first, so a
broken pack reports every problem and registers nothing (`FLX_PACK_INVALID`,
`FLX_SHAPE_DEF_INVALID`, `FLX_REGISTRY_DUPLICATE`); ids must sit in the pack's namespace.

```ts
import { createCoreRegistries, definePack, type ShapeDef } from '@fluxion/sdk';

const box: ShapeDef = { id: 'acme:box', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 120, h: 80 } };
export const acmePack = definePack({ id: 'acme', shapes: [box] });

const registries = createCoreRegistries();
const registered = acmePack.register(registries); // Result: a Disposable, or diagnostics
```

`registerShapeDef(registries, def, source)` validates and registers one definition of unknown shape.

## Shape geometry

`evaluateOutline(def, size, params)` evaluates a definition's outline and decorations to a cubic
path, within a step budget; `hitTestShape`, `outlineDistance` and `projectToOutline` hit-test and
project onto it. `parseMarkerDef`, `MARKER_SIZE` and `markerTrim` describe markers: a path in a
10 x 10 box, sized in stroke widths, with the route trimmed under it by its inset.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
