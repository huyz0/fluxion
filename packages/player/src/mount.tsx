// Mounting the deck (ADR-0154): the one-file player's host calls this with the store of a loaded document; React DOM is the player's own
// dependency, so the host lists no React.
import type { Store } from '@fluxion/core';
import type { AssetUrls, RenderRegistries } from '@fluxion/render';
import { createRoot } from 'react-dom/client';
import type { ChromeLabels } from './deck-chrome.js';
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
 * How the deck mounted by {@link mountPlayer} behaves.
 *
 * @public
 */
export type MountOptions = {
  /** The URLs images are drawn from, by asset id (keep it stable). */
  readonly assets?: AssetUrls;
  /** Keep the position in the page's URL hash (FR-PRS-005); default false. */
  readonly links?: boolean;
  /** Draw the chrome (progress bar, counter, controls); default false. */
  readonly chrome?: boolean;
  /** The names of the chrome's controls in the page's language. */
  readonly labels?: Partial<ChromeLabels>;
  /** The colour of the bars around a screen of another shape (default black). */
  readonly background?: string;
};

/**
 * Draw the document in `store` into `root` as a deck of screens with keyboard navigation.
 *
 * @public
 */
export function mountPlayer(root: HTMLElement, store: Store, registries: RenderRegistries, options: MountOptions = {}): MountedPlayer {
  const mounted = createRoot(root);
  mounted.render(
    <PlayerDeck
      store={store}
      registries={registries}
      {...(options.assets === undefined ? {} : { assets: options.assets })}
      {...(options.links === undefined ? {} : { links: options.links })}
      {...(options.chrome === undefined ? {} : { chrome: options.chrome })}
      {...(options.labels === undefined ? {} : { labels: options.labels })}
      {...(options.background === undefined ? {} : { background: options.background })}
    />,
  );
  return { unmount: () => mounted.unmount() };
}
