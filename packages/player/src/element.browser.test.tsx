import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineFluxionPlayer, type FluxOpener, type PlayerPosition } from './element.js';
import { renderRegistriesFor } from './registries.js';

type Player = HTMLElement & {
  load(bytes: Uint8Array): Promise<void>;
  next(): void;
  prev(): void;
  goTo(screen: number | string, group?: number): void;
  readonly position: PlayerPosition | undefined;
};

let tag = '';
let seq = 0;
let host: HTMLElement;
const released = vi.fn();

/** Three visible screens (the second has a build group) and a hidden one; the opener refuses bytes that are not `ok`. */
function opener(): { open: FluxOpener; ids: string[] } {
  const b = documentBuilder({ seed: 74 });
  const a = b.screen({ size: { w: 1600, h: 900 } });
  const hidden = b.screen({ size: { w: 1600, h: 900 } });
  const c = b.screen({ size: { w: 1600, h: 900 } });
  const d = b.screen({ size: { w: 1600, h: 900 } });
  const late = b.rect(c, { x: 10, y: 10, w: 100, h: 50 });
  const doc = b.build();
  const records = {
    ...doc.records,
    [hidden]: { ...(doc.records[hidden] as object), hidden: true },
    tl: { id: 'tl', type: 'timeline', screenId: c, name: 'main', index: 'a0' },
    s1: { id: 's1', type: 'step', timelineId: 'tl', index: 'a1', trigger: { kind: 'onClick' }, animations: [{ id: 's1a', effect: 'appear', targets: [late] }] },
  };
  const open: FluxOpener = async (bytes) => {
    if (new TextDecoder().decode(bytes) !== 'ok') return { ok: false, message: 'this file cannot be opened' };
    const core = createCore({ ...doc, records } as unknown as typeof doc, { validate: false });
    return { ok: true, value: { store: core.store, registries: renderRegistriesFor(core.registries), release: released } };
  };
  return { open, ids: [a, c, d] };
}
const ok = new TextEncoder().encode('ok');
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const make = (attrs: Record<string, string> = {}): Player => {
  const el = document.createElement(tag) as Player;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  host.append(el);
  return el;
};
const events = (el: HTMLElement, type: string): CustomEvent[] => {
  const seen: CustomEvent[] = [];
  el.addEventListener(type, (e) => seen.push(e as CustomEvent));
  return seen;
};
const shownId = (el: Player) => el.shadowRoot?.querySelector('.fx-screen')?.getAttribute('data-screen-id');

beforeEach(() => {
  tag = `fluxion-player-t${++seq}`;
  host = document.createElement('div');
  host.style.cssText = 'position:relative;width:640px;height:360px';
  document.body.append(host);
  released.mockClear();
});
afterEach(() => {
  host.remove();
  vi.unstubAllGlobals();
});

describe('the <fluxion-player> element (FR-PRS-009)', () => {
  it('FR-PRS-009: load draws the first screen in the shadow root, leaves the page alone, and goTo, next and prev move it with a fluxion-position event each', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const el = make();
    const loads = events(el, 'fluxion-load');
    const moves = events(el, 'fluxion-position');
    await el.load(ok);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    expect(loads.map((e) => e.detail)).toEqual([{ screens: 3 }]);
    expect(el.position).toEqual({ screen: ids[0], index: 0, group: 0, count: 3 });
    // the content CSS is in the shadow root and not in the page's head
    expect(el.shadowRoot?.adoptedStyleSheets.length ?? el.shadowRoot?.querySelectorAll('style').length).toBeGreaterThan(0);
    expect(document.head.querySelector('style[data-fx-content]')).toBeNull();
    el.goTo(3);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[2]));
    expect(moves.at(-1)?.detail).toEqual({ screen: ids[2], index: 2, group: 0, count: 3 });
    el.prev();
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[1]));
    el.goTo(ids[0] as string);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    el.next();
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[1]));
    // events leave the shadow root and reach the page
    const onPage = vi.fn();
    host.addEventListener('fluxion-position', onPage);
    el.next();
    await vi.waitFor(() => expect(onPage).toHaveBeenCalled());
    // an unknown screen and a call before a file is drawn do nothing
    el.goTo(99);
    el.goTo('nope');
    expect(el.position?.screen).toBe(ids[1]);
  });

  it('FR-PRS-009: the start attribute opens at a screen number or id, and the controls attribute draws the chrome', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const el = make({ start: '2', controls: '' });
    await el.load(ok);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[1]));
    expect(el.shadowRoot?.querySelector('[part~="chrome"]')).not.toBeNull();
    el.removeAttribute('controls');
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part~="chrome"]')).toBeNull());
    const byId = make({ start: ids[2] as string });
    await byId.load(ok);
    await vi.waitFor(() => expect(shownId(byId)).toBe(ids[2]));
  });

  it('FR-PRS-009: its keys are its own: they move the deck while it has focus, and the page around it keeps the rest', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const el = make();
    await el.load(ok);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    // a key aimed at the page is not the deck's
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await frame();
    expect(shownId(el)).toBe(ids[0]);
    const stage = el.shadowRoot?.querySelector<HTMLElement>('[data-testid="player-deck"]') as HTMLElement;
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, composed: true }));
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[1]));
  });

  it('FR-PRS-009: a file that cannot be opened is a fluxion-error event and a message in the element, and a newer load wins over an older one', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const el = make();
    const errors = events(el, 'fluxion-error');
    await el.load(new TextEncoder().encode('bad'));
    expect(errors.map((e) => e.detail)).toEqual([{ message: 'this file cannot be opened' }]);
    expect(el.shadowRoot?.querySelector('[part="message"]')?.textContent).toBe('this file cannot be opened');
    // two loads at once: the second is the one drawn, the first's file is let go
    const first = el.load(ok);
    const second = el.load(ok);
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('FR-PRS-009: src is fetched without credentials or referrer, a failed fetch is an error event, and removing the element lets go of the file', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith('missing.flux') ? new Response('', { status: 404 }) : new Response(ok);
    });
    const el = make({ src: 'deck.flux' });
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    expect(calls[0]?.url).toBe(new URL('deck.flux', document.baseURI).href);
    expect(calls[0]?.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    const errors = events(el, 'fluxion-error');
    el.setAttribute('src', 'missing.flux');
    await vi.waitFor(() => expect(errors.length).toBe(1));
    expect(errors[0]?.detail.message).toContain('404');
    el.setAttribute('src', 'deck.flux');
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    released.mockClear();
    el.remove();
    await frame();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('FR-PRS-009: defining a tag twice leaves the first definition', () => {
    const first = opener();
    defineFluxionPlayer(first.open, tag);
    const before = customElements.get(tag);
    defineFluxionPlayer(opener().open, tag);
    expect(customElements.get(tag)).toBe(before);
  });

  it('FR-PRS-009: the overview works inside the shadow root: focus starts on the current thumbnail, the arrows move it, and Escape gives focus back to the stage', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const el = make();
    await el.load(ok);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    const stage = el.shadowRoot?.querySelector<HTMLElement>('[data-testid="player-deck"]') as HTMLElement;
    stage.focus();
    const key = (to: Element, k: string) => to.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }));
    key(stage, 'o');
    const thumbs = () => [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-testid="deck-overview"] button') ?? [])];
    await vi.waitFor(() => expect(thumbs().length).toBe(3));
    expect(el.shadowRoot?.activeElement).toBe(thumbs()[0]);
    key(thumbs()[0] as Element, 'ArrowRight');
    expect(el.shadowRoot?.activeElement).toBe(thumbs()[1]);
    key(thumbs()[1] as Element, 'Tab');
    expect(el.shadowRoot?.activeElement).toBe(thumbs()[2]);
    key(thumbs()[2] as Element, 'Escape');
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[data-testid="deck-overview"]')).toBeNull());
    expect(el.shadowRoot?.activeElement).toBe(stage);
  });

  it('FR-PRS-009: moving the element in the page keeps its deck and position, and an element taken out and put back later draws its file again', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    const el = make();
    const loads = events(el, 'fluxion-load');
    await el.load(ok);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    el.goTo(2);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[1]));
    // a move: out and in within one task
    const other = document.createElement('div');
    host.append(other);
    other.append(el);
    await frame();
    expect(shownId(el)).toBe(ids[1]);
    expect(released).not.toHaveBeenCalled();
    expect(loads).toHaveLength(1);
    // taken out for good, the file is let go of; put back, it is drawn again from the bytes it was given
    el.remove();
    await frame();
    expect(released).toHaveBeenCalledTimes(1);
    host.append(el);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
  });

  it('FR-PRS-009: a fetch that fails after the bytes were loaded does not take the loaded deck down, and switching controls keeps the screen', async () => {
    const { open, ids } = opener();
    defineFluxionPlayer(open, tag);
    let fail: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise((_resolve, reject) => {
          fail = () => reject(new Error('network down'));
        }),
    );
    const el = make({ src: 'slow.flux' });
    const errors = events(el, 'fluxion-error');
    await el.load(ok);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[0]));
    fail?.();
    await frame();
    expect(errors).toHaveLength(0);
    expect(shownId(el)).toBe(ids[0]);
    el.goTo(3);
    await vi.waitFor(() => expect(shownId(el)).toBe(ids[2]));
    el.setAttribute('controls', '');
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part~="chrome"]')).not.toBeNull());
    expect(shownId(el)).toBe(ids[2]);
    expect(el.position?.index).toBe(2);
  });
});
