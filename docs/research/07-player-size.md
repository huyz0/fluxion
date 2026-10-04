# 07 — Where the one-file player's bytes go (M11.2)

> Read when: cutting the player (M11.5, M11.18), deciding ADR-0026 (player packaging), or settling what NFR-SIZE-001 and NFR-SIZE-003 measure
> (M10.45). Measured 2026-10-04 on the build at M10.66.

## What was measured

`packages/player-inline/dist/player.inline.js`, the classic script a `.flux.html` embeds (ADR-0154): **729.6 kB, 224 kB gzip** (size-limit; zlib level 9: 224.0 kB)
against `PLAYER_CORE_GZIP` = 150 kB. `pnpm exec size-limit` reports the other two entries: `packages/player/dist/index.js` bundled with its dependencies
is 136.9 kB gzip, the editor's initial bundle 272.3 kB gzip. The 136.9 kB entry holds both server renderers and not the `react-dom` client (only the element's
mount imports that), so it is not a React-included figure and is not what NFR-SIZE-001 is held to; the one-file player is.

Method: the same build with a source map (`tsdown` with the iife config of `packages/player-inline/tsdown.config.ts`, `sourcemap: true`, written to a scratch
directory), the map's mappings decoded to the generated span of every source, spans grouped by package, and each group's text compressed on its own with zlib
level 9. Groups compressed apart add up to more than the whole (each loses the others' shared dictionary), so the gzip column is a weight, not a share that
sums to 224 kB.

## Result

| Source | Raw kB | Gzip kB (alone) | Share of raw |
|---|---:|---:|---:|
| `react-dom` client (`react-dom-client.production.js`) | 204 | 62.7 | 28 % |
| `react-dom` **server**, browser build | 100 | 30.7 | 14 % |
| `react-dom` **server**, legacy browser build | 95 | 28.4 | 13 % |
| `zod` | 100 | 26.5 | 14 % |
| `@fluxion/core` | 59 | 19.2 | 8 % |
| `@fluxion/schema` | 36 | 12.2 | 5 % |
| `@fluxion/render` | 29 | 9.6 | 4 % |
| `@fluxion/format` | 24 | 9.5 | 3 % |
| `@fluxion/theme` | 19 | 7.4 | 3 % |
| `@fluxion/geometry` | 11 | 4.5 | 1.5 % |
| `react`, `@fluxion/basic`, `@fluxion/routing`, `alien-signals`, `scheduler`, others | 52 | 19 | 7 % |

## What it says

1. **Two copies of the server renderer are in a player that only draws on the client.** `react-dom/server.browser` and its legacy twin come in through
   `packages/render/src/ssr.ts` (the static render path, ADR-0015), which the render package's entry exports and the bundle cannot drop. They weigh about
   59 kB gzip alone and 195 kB raw. Moving `ssr.ts` behind its own entry (a subpath export the CLI and exporters import, not the player) is the largest single cut.
2. **Zod is 27 kB gzip for validation the player repeats.** The studio and the CLI validate and repair; the player reads with a lean reader that refuses what it cannot read
   instead (ADR-0026). `@fluxion/schema` (12 kB) goes with part of it where only the validators use it.
3. **React's client is the floor**, about 63 kB gzip alone, plus `react` and `scheduler` (about 5 kB). A React-compatible replacement would save about 60 kB
   more but is a new runtime dependency and a departure from NFR-SIZE-001's "(React included)"; it is not on the cut list, and is recorded here only as the
   fallback if the cuts below fall short.
4. The remainder (core, render, format, theme, geometry, the basic pack) is the player's own work, about 80 kB gzip alone, before M11 adds the controller, chrome,
   touch and the element.

## The cut list and what it is expected to give

| Cut | Expected gzip (alone) | Row |
|---|---:|---|
| `ssr.ts` out of the player's graph (react-dom/server twice) | about 59 kB | M11.5 |
| Zod and the validators out of the player (a lean reader, ADR-0026) | about 27 kB, schema's validators part of 12 kB | M11.5 |
| Lazy chunks for what the first screen does not need (the overview grid, the debug overlay, interaction code as M24 arrives) | by row | M11.5, M11.18 |

Alone-gzip savings overstate the whole-file saving (shared dictionary), so the first two cuts are expected to bring 224 kB to roughly 145 to 160 kB, **not
safely under 150 kB**, and M11 then adds code. M11.18's remaining cuts (trimming `core` and `format` out of the player where only the editor needs them, lazy
chunks) have to find the rest, and the stop-and-hand-back condition of M11.2 applies if they cannot.

## Consequence for the `.flux.html` size question (M10.45)

The raw size drops with the same cuts: removing the two server renderers (195 kB raw) and Zod (100 kB raw) takes 730 kB to about 435 kB, and the schema
validators another 30 kB or so. A `.flux.html` of the 20-screen fixture adds about 20 kB of base64, so the **raw** 450 kB reading of NFR-SIZE-003 becomes
reachable by the same work that serves NFR-SIZE-001, and the gzip reading (241 kB today) shrinks with it. The choice of basis is still the human's (M10.45);
this report removes the argument that the raw reading cannot be met.
