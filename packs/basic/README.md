# @fluxion/pack-basic

The first-party basic pack: 21 shape definitions (FR-SHP-002) and five connector end markers
(FR-CON-003), in the namespace `basic`. It is plain data built with `@fluxion/sdk` only, and a host
registers it into its core registries like any plugin (ADR-0017):

```ts
import { basicPack } from '@fluxion/pack-basic';
import { createCoreRegistries } from '@fluxion/sdk';

const registries = createCoreRegistries();
const registered = basicPack.register(registries); // every shape and marker, or diagnostics
```

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M5: 21 shapes, 5 markers |

## Shapes

Each shape is a `ShapeDef` (ADR-0016): an outline evaluated from the element's size and params,
anchors (default `n`, `e`, `s`, `w`, `center`), a text region and handles.

| Group | Ids |
|---|---|
| Boxes | `basic:rect`, `basic:rounded-rect` (param `r`), `basic:text-box`, `basic:image-frame` |
| Round | `basic:ellipse`, `basic:cloud`, `basic:cylinder` |
| Polygons | `basic:triangle` (param `apex`), `basic:diamond`, `basic:parallelogram`, `basic:trapezoid`, `basic:hexagon`, `basic:octagon`, `basic:star` (params `points`, `inner`) |
| Callouts | `basic:block-arrow`, `basic:callout`, `basic:document`, `basic:note` |
| Open outlines (strokes) | `basic:line` (across the middle of its box), `basic:polyline` (param `vertices`) and `basic:freehand` (param `stroke`), their points in the box |

## Markers

Open markers, stroked as wide as the connector and sized in stroke widths:

| Id | Draws |
|---|---|
| `basic:open-arrow` | an open arrowhead |
| `basic:crows-foot-one` | exactly one (two bars) |
| `basic:crows-foot-many` | one or many (a crow's foot and a bar) |
| `basic:crows-foot-zero-one` | zero or one (a ring and a bar) |
| `basic:crows-foot-zero-many` | zero or many (a ring and a crow's foot) |

`examples/shapes-gallery.flux.json` shows every shape and marker; the CLI renders it
(`fluxion render examples/shapes-gallery.flux.json -o gallery.html`).

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
