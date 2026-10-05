import { describe, expect, it } from 'vitest';
import { bindLinks, formatLink, type LinkWindow, parseLink } from './deck-links.js';
import { PresentationController } from './presentation-controller.js';

const clock = { now: () => 0, frame: () => () => undefined };
const screens = ['a', 'b', 'c'] as never[];
const make = () => new PresentationController({ screens: () => screens, groups: (s) => (s === ('b' as never) ? 2 : 0) }, clock);

/** A window with a history of urls: push adds, replace rewrites, `back` pops and fires popstate. */
function fakeWindow(hash: string) {
  const entries = [hash];
  let at = 0;
  const listeners = new Set<() => void>();
  const log: string[] = [];
  const win: LinkWindow = {
    location: {
      get hash() {
        return entries[at] as string;
      },
    },
    history: {
      state: null,
      pushState: (_s, _u, url) => {
        entries.splice(at + 1, entries.length, url);
        at += 1;
        log.push(`push ${url}`);
      },
      replaceState: (_s, _u, url) => {
        entries[at] = url;
        log.push(`replace ${url}`);
      },
    },
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
  };
  const go = (delta: number) => {
    at += delta;
    for (const l of [...listeners]) l();
  };
  return { win, log, go, listeners, entries: () => entries.slice() };
}

describe('deep links (FR-PRS-005)', () => {
  it('FR-PRS-005: a hash names a screen and a group, and what it does not name is no position', () => {
    expect(parseLink('#/b/2')).toEqual({ screen: 'b', group: 2 });
    expect(parseLink('#/b')).toEqual({ screen: 'b', group: 0 });
    expect(parseLink(formatLink({ screen: 'x y/z' as never, group: 3 }))).toEqual({ screen: 'x y/z', group: 3 });
    for (const bad of ['', '#', '#/', '#b/1', '#/b/x', '#/b/1/2', '#/%E0%A4%A/1']) expect(parseLink(bad), bad).toBeUndefined();
  });

  it('FR-PRS-005: the hash at the start moves the controller there, a hash naming no screen leaves it on the first', () => {
    const c = make();
    bindLinks(c, fakeWindow('#/b/1').win);
    expect(c.position()).toEqual({ screen: 'b', group: 1 });
    const d = make();
    const w = fakeWindow('#/zzz/1');
    bindLinks(d, w.win);
    expect(d.position()).toEqual({ screen: 'a', group: 0 });
    expect(w.entries()).toEqual(['#/a/0']);
  });

  it('FR-PRS-005: a new screen is pushed, a new group replaces the entry, and back returns to the screen before', () => {
    const c = make();
    const w = fakeWindow('');
    bindLinks(c, w.win);
    c.next();
    expect(w.entries()).toEqual(['#/a/0', '#/b/0']);
    c.next();
    c.next();
    c.next();
    // two groups of b replaced its entry; c is pushed
    expect(w.log).toEqual(['replace #/a/0', 'push #/b/0', 'replace #/b/1', 'replace #/b/2', 'push #/c/0']);
    w.go(-1);
    expect(c.position()).toEqual({ screen: 'b', group: 2 });
    w.go(-1);
    expect(c.position()).toEqual({ screen: 'a', group: 0 });
    // a move made by the browser is not written back
    expect(w.log).toHaveLength(5);
    w.go(1);
    expect(c.position()).toEqual({ screen: 'b', group: 2 });
  });

  it('FR-PRS-005: back to an entry with no hash goes to the first screen, and stopping ends the links', () => {
    const c = make();
    const w = fakeWindow('');
    const stop = bindLinks(c, w.win);
    c.last();
    // an entry the page did not write, with no hash: the browser lands on it
    w.win.history.pushState(null, '', '');
    w.go(0);
    expect(c.position()).toEqual({ screen: 'a', group: 0 });
    c.last();
    stop();
    expect(w.listeners.size).toBe(0);
    c.first();
    expect(w.entries().at(-1)).toBe('#/c/0');
  });

  it('FR-PRS-005: a history that refuses a write does not stop the deck, and a foreign hash is left alone', () => {
    const c = make();
    const w = fakeWindow('');
    const refusing: LinkWindow = {
      ...w.win,
      history: {
        state: { router: 1 },
        pushState: () => {
          throw new Error('SecurityError');
        },
        replaceState: () => {
          throw new Error('SecurityError');
        },
      },
    };
    bindLinks(c, refusing);
    expect(c.next()).toBe(true);
    expect(c.position()).toEqual({ screen: 'b', group: 0 });
    // a hash another script wrote is not the first screen
    const d = make();
    const x = fakeWindow('');
    bindLinks(d, x.win);
    d.last();
    x.win.history.pushState(null, '', '#foo');
    x.go(0);
    expect(d.position()).toEqual({ screen: 'c', group: 0 });
  });
});
