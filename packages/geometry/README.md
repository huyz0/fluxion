# @fluxion/geometry

Pure 2D geometry for Fluxion: vectors, affine matrices, boxes, cubic paths, sampling,
intersections, point-in-path and spatial indexes.

| Layer | Pure | Status |
|---|---|---|
| L0 | yes | M2 — primitives below; no outlines of shape definitions yet |

## Public surface

| Area | Exports |
|---|---|
| Vectors | `Vec2`, `vec2`, `add`, `sub`, `scale`, `dot`, `cross`, `length`, `distance`, `normalize`, `rotate`, `lerp`, `equalsApprox` |
| Matrices | `Mat2d`, `identity`, `translate`, `rotation`, `scaling`, `multiply`, `invert`, `apply`, `determinant` |
| Boxes | `Box`, `boxFromPoints`, `boxUnion`, `boxIntersection`, `boxIntersects`, `boxContains`, `boxContainsBox`, `boxInflate`, `boxCenter`, `boxCorners`, `transformBox` |
| Elements | `ElementTransform`, `elementMatrix`, `elementCorners`, `elementBounds` (rotation and flips about the box centre) |
| Paths | `Path`, `CubicSegment`, `pathFromCommands` (returns a `Result`), `pointAt`, `derivativeAt`, `splitAt`, `segmentBounds`, `pathBounds` |
| Queries | `createPathSampler` (arc-length sampling), `nearestPoint`, `intersectSegments`, `intersectCubics`, `intersectPaths`, `pointInPath` (`nonzero`/`evenodd`) |
| Spatial index | `createStaticIndex` (flatbush), `createDynamicIndex` (rbush): `search`, `collides`; ids returned sorted (ADR-0141) |

```ts
import { createDynamicIndex, elementBounds } from '@fluxion/geometry';

const bounds = elementBounds({ x: 100, y: 50, w: 200, h: 100, rot: 30 });
const index = createDynamicIndex([{ id: 'e1', box: bounds }]);
index.search({ x: 0, y: 0, w: 150, h: 150 }); // ['e1']
```

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
