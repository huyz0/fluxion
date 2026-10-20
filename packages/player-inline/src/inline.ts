// The one-file player's entry (ADR-0154): `Fluxion.start(bytes, root)` opens a `.flux`, registers the bundled packs and draws the deck.
// It is the whole of what a `.flux.html` runs: no network, no `eval`, nothing outside the file's own bytes. Bundled by tsdown into
// `dist/player.inline.js` (one classic script that defines the global `Fluxion`).
import { mountPlayer } from '@fluxion/player/mount';
import { openFlux } from './open-flux.js';
import { embeddedRoutingWorker } from './routing-chunk-loader.js';

/**
 * What `start` came to.
 *
 * @public
 */
export type StartResult =
  | {
      /** The document is on the page. */
      readonly ok: true;
      /** Remove the player and release the images. */
      readonly unmount: () => void;
    }
  | {
      /** Nothing could be shown. */
      readonly ok: false;
      /** Why, as one line (it is also written into the root). */
      readonly message: string;
    };

/** Write `message` into `root` as text (never as markup). */
function show(root: HTMLElement, message: string): StartResult {
  root.textContent = message;
  return { ok: false, message };
}

/**
 * Open the `.flux` file `bytes` and draw it into `root`: the screens in order, the arrow keys to move. The routing chunk the page embeds
 * routes the connectors in a worker: `root`'s `data-routes` is `pending` until then, `settled` once the global routes are drawn and `cheap` when the
 * page has no chunk (M16.28). Whatever goes wrong (a file that
 * cannot be opened, a pack that fails to register, a document the engine cannot take, a page that refuses the mount) is a message written
 * into `root`, not an exception, and no image URL is left behind.
 *
 * @public
 */
export async function start(bytes: Uint8Array, root: HTMLElement): Promise<StartResult> {
  // a root that is not an element is refused at the mount below, as a message: the routes' state is marked only on an element
  const mark = (state: string) => (root instanceof Element ? root.setAttribute('data-routes', state) : undefined);
  mark('pending');
  const opened = await openFlux(bytes, embeddedRoutingWorker(root.ownerDocument ?? document), (ok) => mark(ok ? 'settled' : 'cheap'));
  if (!opened.ok) return show(root, opened.message);
  try {
    const mounted = mountPlayer(root, opened.value.store, opened.value.registries, {
      ...(opened.value.assets === undefined ? {} : { assets: opened.value.assets }),
      links: true,
      chrome: true,
    });
    return {
      ok: true,
      unmount: () => {
        mounted.unmount();
        opened.value.release();
      },
    };
  } catch (e) {
    opened.value.release();
    return show(root, `This file cannot be shown: ${e instanceof Error ? e.message : String(e)}`);
  }
}
