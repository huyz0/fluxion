# @fluxion/routing

Connector geometry, pure (no DOM, no clock): where a connector's ends attach, the path between them,
where the line stops under its markers and where its labels sit (FR-ANC-001/002, FR-RTE-001,
FR-CON-002/003/006/012).

| Layer | Pure | Status |
|---|---|---|
| L2 | yes | M5: anchors, four routers, trimming, labels |

## Anchors

A binding's `AnchorRef` says where an end attaches; `resolveAnchor(target, ref, toward)` gives the
point and the outward direction in screen coordinates, through the element's rotation and flips:

| Kind | Resolves to |
|---|---|
| `floating` | the outline point on the ray from the element's centre toward the other end (FR-ANC-001) |
| `named` | an anchor of the instance, then of its definition, then the defaults `n`, `e`, `s`, `w`, `center` (FR-ANC-002); an unknown name floats |
| `side` | a point along one side (`t`, middle by default) |
| `point` | a fraction of the element's box |
| `auto` | floats until anchor choice arrives (FR-ANC-004, M16) |

`shapeAnchorTarget` builds the target from a shape definition's outline (the box when there is none).

## Routers

`routeConnector(view, { shapeDefs, routers }, id)` resolves both ends of a connector from its
bindings (or free points) and routes them with the router registered for its `route.type`; an
unknown type, or a router that fails, draws straight. `registerBuiltinRouters` registers:

| Type | Router |
|---|---|
| `straight` | one line |
| `curved` | one cubic per leg, leaving and arriving along the anchor directions, Catmull-Rom through waypoints |
| `polyline` | lines through the waypoints |
| `orthogonal` | axis-aligned elbows from short stubs along the anchor directions, never doubling back; no obstacle avoidance |

## Markers and labels

`trimRoute(commands, start, end)` shortens a route under its end markers by a straight distance
(at most half the end segment), aiming a cut curve at the old end so a marker's tip lands on it.
`labelPosition(commands, t, offset)` places a label at fraction `t` of the route's arc length.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
