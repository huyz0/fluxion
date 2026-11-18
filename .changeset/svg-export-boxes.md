---
'@fluxion/render': minor
'@fluxion/exporters': minor
---

SVG export draws frames (members clipped in screen coordinates, turned and rounded as the frame), images (cropped, fitted and masked), image fills, component snapshots, shadows and effects (SVG 1.1 filter primitives with literal flood colours) and shape artwork (literal colours, prefixed ids). Images come only from the new `assets` port of `exportSvg` as `data:` URLs; a missing one is reported as `FLX_EXPORT_ASSET_MISSING`, a component without a snapshot as `FLX_EXPORT_NO_SNAPSHOT`. `@fluxion/render/svg` exports `FrameSvg` and `ImageSvg`.
