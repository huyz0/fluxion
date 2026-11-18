---
'@fluxion/core': minor
'@fluxion/render': minor
'@fluxion/exporters': minor
---

SVG export core (ADR-0056, FR-EXP-004). core gains `layoutStyled`, which lays styled text out into lines with baselines, alignment offsets and positioned pieces (`wrapStyled` is its projection). render gains the `@fluxion/render/svg` subpath: `ScreenSvgView`, the svg-surface leaves of shapes, text, connectors and groups (`ElementView.Svg`), and the `SvgSurface` context for the measurer and findings; render's main entry and the player carry none of it. `@fluxion/exporters` gains `exportSvg(file, options, ports)`, which writes one screen as standalone SVG 1.1: nested per-element `<svg>`, literal colours, text as measured `<tspan>`s, no `foreignObject`, ids renumbered `fx<n>-<k>`, and the screen's package (the screen, its master and their references) base64 in `<metadata>`; and `svg11Problems`, the structural checker the tests use.
