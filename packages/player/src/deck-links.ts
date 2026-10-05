// Deep links (FR-PRS-005): the position of a presentation in the URL's hash, `#/<screen id>/<group>`. A new screen is a history entry (the browser's back
// button returns to the screen before), a build group within a screen replaces the entry, and a reload or a shared link opens at the position. The window is
// a port: only the parts below are used, so the binding is tested with a fake.
import type { RecordId } from '@fluxion/schema';
import type { Position, PresentationController } from './presentation-controller.js';

/**
 * The parts of a window the links use.
 *
 * @public
 */
export type LinkWindow = {
  /** The page's location: the hash is read. */
  readonly location: {
    /** The hash, `#` first (empty when there is none). */
    readonly hash: string;
  };
  /** The session history: entries are pushed and replaced. */
  readonly history: {
    /** The state of the current entry, kept when its url is rewritten. */
    readonly state: unknown;
    /** Add an entry. */
    pushState(state: unknown, unused: string, url: string): void;
    /** Rewrite the current entry. */
    replaceState(state: unknown, unused: string, url: string): void;
  };
  /** Listen to the browser's back and forward moves. */
  addEventListener(type: 'popstate', listener: () => void): void;
  /** Stop listening. */
  removeEventListener(type: 'popstate', listener: () => void): void;
};

/**
 * The position a hash names, or nothing when it names none (`#/<screen id>` is the screen before any of its groups).
 *
 * @public
 */
export function parseLink(hash: string): Position | undefined {
  const match = /^#\/([^/]+)(?:\/(\d+))?$/.exec(hash);
  if (match === null) return undefined;
  let screen: string;
  try {
    screen = decodeURIComponent(match[1] as string);
  } catch {
    return undefined;
  }
  return { screen: screen as RecordId, group: match[2] === undefined ? 0 : Number(match[2]) };
}

/**
 * The hash that names `position`.
 *
 * @public
 */
export const formatLink = (position: Position): string => `#/${encodeURIComponent(position.screen)}/${position.group}`;

/**
 * Keep the URL and `controller` together: the hash at the start moves the controller to its position, every move of the controller writes the hash (a new
 * screen is pushed, a new group replaces the entry), and the browser's back and forward move the controller. Returns the way to stop.
 *
 * @public
 */
export function bindLinks(controller: PresentationController, win: LinkWindow): () => void {
  // a browser may refuse the write (a sandboxed frame, Safari's limit on calls): the links then stop, the deck goes on
  const write = (how: 'pushState' | 'replaceState', position: Position): void => {
    try {
      win.history[how](win.history.state, '', formatLink(position));
    } catch {
      // not written
    }
  };
  let last = controller.position();
  const start = parseLink(win.location.hash);
  if (start !== undefined) controller.goTo(start.screen, start.group);
  last = controller.position();
  // the entry the page opened at names where it is, so back from the next screen returns here
  if (last !== undefined) write('replaceState', last);
  let applying = false;
  const stop = controller.subscribe((position) => {
    if (applying || position === undefined) return;
    const same = last !== undefined && last.screen === position.screen;
    if (last !== undefined && same && last.group === position.group) return;
    write(same ? 'replaceState' : 'pushState', position);
    last = position;
  });
  const onPop = () => {
    const wanted = parseLink(win.location.hash);
    applying = true;
    try {
      // an entry with no hash is the page's first; one with a hash that is not a link is another script's and is left alone
      if (wanted !== undefined) controller.goTo(wanted.screen, wanted.group);
      else if (win.location.hash === '') controller.first();
    } finally {
      applying = false;
    }
    last = controller.position();
  };
  win.addEventListener('popstate', onPop);
  return () => {
    stop();
    win.removeEventListener('popstate', onPop);
  };
}
