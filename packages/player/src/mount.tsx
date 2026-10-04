// Mounting the deck (ADR-0154): the one-file player's host calls this with the store of a loaded document; React DOM is the player's own
// dependency, so the host lists no React.
import type { Store } from '@fluxion/core';
import type { AssetUrls, RenderRegistries } from '@fluxion/render';
import { createRoot } from 'react-dom/client';
import { PlayerDeck } from './player-deck.js';

/**
 * A mounted player.
 *
 * @public
 */
export type MountedPlayer = {
  /** Remove the player from the page. */
  readonly unmount: () => void;
};

/**
 * Draw the document in `store` into `root` as a deck of screens with keyboard navigation.
 *
 * @public
 */
export function mountPlayer(root: HTMLElement, store: Store, registries: RenderRegistries, assets?: AssetUrls): MountedPlayer {
  const mounted = createRoot(root);
  mounted.render(<PlayerDeck store={store} registries={registries} {...(assets === undefined ? {} : { assets })} />);
  return { unmount: () => mounted.unmount() };
}
