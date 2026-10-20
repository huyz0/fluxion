// The standalone element script's entry (FR-PRS-009, ADR-0026): defining `<fluxion-player>` over the same opening as `Fluxion.start`. Built by tsdown into
// `dist/fluxion-player.js`, a classic script a page includes to use the element: `<script src="fluxion-player.js"></script><fluxion-player src="deck.flux" controls>`.
import { defineFluxionPlayer } from '@fluxion/player/element';
import { openFlux } from './open-flux.js';
import { siblingRoutingWorker } from './routing-chunk-loader.js';

// the script's own address is known only while it runs: the routing chunk is `fluxion-routing.js` beside it, one worker per player (M16.28)
const scriptSrc = (document.currentScript as HTMLScriptElement | null)?.src;

defineFluxionPlayer(async (bytes) => openFlux(bytes, await siblingRoutingWorker(scriptSrc)));
