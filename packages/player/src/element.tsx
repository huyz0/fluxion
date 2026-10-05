// The `<fluxion-player>` element (FR-PRS-009, ADR-0026): a presentation in a page that is not the player's own. It draws into an open shadow root, so the page's
// styles and the player's do not meet (the content CSS is adopted into the root, never put in the page's head, and the chrome's parts can be styled from outside
// with `::part`); its keys are its own, taken while it has focus, not the page's; its position is in its events, not the page's URL. The element opens a file through a port
// (`FluxOpener`): the host that has the packs, the fonts and the images wired (the script `@fluxion/player-inline` builds for plain pages) supplies it.
import type { Store } from '@fluxion/core';
import { type AssetUrls, CONTENT_CSS, ContentCssContext, presentationOrder, type RenderRegistries } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { createRoot, type Root } from 'react-dom/client';
import { PlayerDeck } from './player-deck.js';
import type { PresentationController } from './presentation-controller.js';

/**
 * A file opened, ready to draw.
 *
 * @public
 */
export type OpenedFlux = {
  /** The document (read-only). */
  readonly store: Store;
  /** The registries its views are looked up in. */
  readonly registries: RenderRegistries;
  /** The URLs its images are drawn from, by asset id. */
  readonly assets?: AssetUrls;
  /** Let go of what opening made (image URLs, loaded fonts). */
  readonly release: () => void;
};

/**
 * Opens the bytes of a `.flux` for the element: the document and what it needs to be drawn, or why not.
 *
 * @public
 */
export type FluxOpener = (bytes: Uint8Array) => Promise<{ readonly ok: true; readonly value: OpenedFlux } | { readonly ok: false; readonly message: string }>;

/**
 * Where a presentation is, as the element's `fluxion-position` event carries it.
 *
 * @public
 */
export type PlayerPosition = {
  /** The id of the screen on show. */
  readonly screen: RecordId;
  /** Its place among the visible screens, from 0. */
  readonly index: number;
  /** How many of its build groups have played. */
  readonly group: number;
  /** How many visible screens there are. */
  readonly count: number;
};

/** The element's own styles: it is a block that fills the space it is given, and the stage fills it. */
const HOST_CSS =
  ':host{display:block;position:relative;overflow:hidden;min-height:120px;background:#000}:host([hidden]){display:none}.fx-message{margin:0;padding:12px;color:#fff;font:14px system-ui,sans-serif}';

/** The sheet the shadow root adopts: the content CSS and the element's. */
function sheet(): CSSStyleSheet | HTMLStyleElement {
  const css = `${CONTENT_CSS}\n${HOST_CSS}`;
  if (typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
    const adopted = new CSSStyleSheet();
    adopted.replaceSync(css);
    return adopted;
  }
  const style = document.createElement('style');
  style.textContent = css;
  return style;
}

/** What the core needs of the element it works for. */
type Host = {
  /** An attribute's value, or null. */
  readonly attribute: (name: string) => string | null;
  /** Dispatch a bubbling, composed custom event. */
  readonly emit: (type: string, detail: unknown) => void;
};

/**
 * What an element does, apart from being an element (so a server can import this module): the stage in its shadow root, the file open in it, the deck drawn
 * from it and the controller that moves it.
 */
class PlayerCore {
  readonly #host: Host;
  readonly #open: FluxOpener;
  readonly #mount: HTMLElement;
  #root: Root | undefined;
  #opened: OpenedFlux | undefined;
  #controller: PresentationController | undefined;
  #stop: (() => void) | undefined;
  /** The load in progress; a newer one makes an older one's result stale. */
  #token = 0;
  /** The fetch in progress; a newer fetch, a load of bytes or letting go makes its result stale. */
  #fetching = 0;
  #abort: AbortController | undefined;
  #inFlight = false;
  /** The bytes last given to `load`, to draw again when the element is put back in a page after it was taken out. */
  #bytes: Uint8Array | undefined;

  constructor(host: Host, open: FluxOpener, mount: HTMLElement) {
    this.#host = host;
    this.#open = open;
    this.#mount = mount;
  }

  get loaded(): boolean {
    return this.#opened !== undefined;
  }

  /** Fetch `src` and open what comes; a newer `src`, a load of bytes or letting go while it is on its way makes it stale and silent. */
  async fetch(src: string): Promise<void> {
    const id = ++this.#fetching;
    this.#inFlight = true;
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    try {
      // no cookies, no referrer: the page's identity is not sent to wherever the file is
      const response = await fetch(new URL(src, document.baseURI), { credentials: 'omit', referrerPolicy: 'no-referrer', signal: abort.signal });
      if (!response.ok) throw new Error(`${src} could not be fetched (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (id === this.#fetching) await this.load(bytes, false);
    } catch (e) {
      if (id === this.#fetching) this.#fail(messageOf(e));
    } finally {
      if (id === this.#fetching) this.#inFlight = false;
    }
  }

  /** The element is in a page: draw what it holds, or fetch `src`, if nothing is drawn or on its way (it was let go of after being taken out). */
  resume(src: string | null): void {
    if (this.loaded || this.#inFlight) return;
    if (src !== null) void this.fetch(src);
    else if (this.#bytes !== undefined) void this.load(this.#bytes);
  }

  /** Open `bytes`; resolves when the deck is drawn or has failed (a `fluxion-error` event says why). */
  async load(bytes: Uint8Array, remember = true): Promise<void> {
    const token = ++this.#token;
    // bytes given directly win over a fetch still on its way
    if (remember) {
      this.#fetching += 1;
      this.#inFlight = false;
      this.#abort?.abort();
      this.#bytes = bytes;
    }
    this.#teardown();
    try {
      const opened = await this.#open(bytes);
      if (token !== this.#token) {
        if (opened.ok) opened.value.release();
        return;
      }
      if (!opened.ok) return this.#fail(opened.message);
      this.#opened = opened.value;
      this.draw();
    } catch (e) {
      if (token === this.#token) this.#fail(messageOf(e));
    }
  }

  next(): void {
    this.#controller?.next();
  }

  prev(): void {
    this.#controller?.prev();
  }

  /** Go to a screen by its number among the visible screens (from 1) or its id. */
  goTo(screen: number | string, group: number): void {
    const store = this.#opened?.store;
    if (this.#controller === undefined || store === undefined) return;
    const id = typeof screen === 'number' ? store.query((view) => presentationOrder(view, false)[screen - 1])() : screen;
    if (id !== undefined) this.#controller.goTo(id as RecordId, group);
  }

  position(): PlayerPosition | undefined {
    const at = this.#controller?.position();
    const store = this.#opened?.store;
    if (at === undefined || store === undefined) return undefined;
    const order = store.query((view) => presentationOrder(view, false))();
    return { screen: at.screen, index: Math.max(0, order.indexOf(at.screen)), group: at.group, count: order.length };
  }

  /** Draw the deck of the file that is open; called again (the chrome switched), it re-renders the same deck, which keeps its place. */
  draw(): void {
    const opened = this.#opened;
    if (opened === undefined) return;
    this.#root ??= createRoot(this.#mount);
    this.#root.render(
      <ContentCssContext.Provider value={false}>
        <PlayerDeck
          store={opened.store}
          registries={opened.registries}
          {...(opened.assets === undefined ? {} : { assets: opened.assets })}
          chrome={this.#host.attribute('controls') !== null}
          layout="container"
          scope="stage"
          onController={this.#attach}
        />
      </ContentCssContext.Provider>,
    );
  }

  /** Let go of everything: the deck, the file, the listeners, a fetch on its way. */
  dispose(): void {
    this.#token += 1;
    this.#fetching += 1;
    this.#inFlight = false;
    this.#abort?.abort();
    this.#teardown();
  }

  /** The deck's controller exists: go to `start` the first time, and report every move. A controller already attached is not attached twice. */
  readonly #attach = (controller: PresentationController): void => {
    if (this.#controller === controller) return;
    const first = this.#controller === undefined;
    this.#stop?.();
    this.#controller = controller;
    const start = this.#host.attribute('start');
    if (first && start !== null) this.goTo(/^\d+$/.test(start) ? Number(start) : start, 0);
    this.#stop = controller.subscribe(() => this.#host.emit('fluxion-position', this.position()));
    if (first) this.#host.emit('fluxion-load', { screens: this.position()?.count ?? 0 });
    this.#host.emit('fluxion-position', this.position());
  };

  #fail(message: string): void {
    this.#teardown();
    const p = document.createElement('p');
    p.className = 'fx-message';
    p.setAttribute('part', 'message');
    p.textContent = message;
    this.#mount.replaceChildren(p);
    this.#host.emit('fluxion-error', { message });
  }

  #teardown(): void {
    this.#stop?.();
    this.#stop = undefined;
    this.#controller = undefined;
    this.#root?.unmount();
    this.#root = undefined;
    this.#opened?.release();
    this.#opened = undefined;
    this.#mount.replaceChildren();
  }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The element class over `open`. */
function makeElement(open: FluxOpener): CustomElementConstructor {
  return class FluxionPlayerElement extends HTMLElement {
    static observedAttributes = ['src', 'start', 'controls'];

    #core: PlayerCore | undefined;

    connectedCallback(): void {
      this.#need().resume(this.getAttribute('src'));
    }

    disconnectedCallback(): void {
      // moving an element in the page takes it out and puts it back in one task: only an element still out of the page after that is let go of
      queueMicrotask(() => {
        if (!this.isConnected) this.#core?.dispose();
      });
    }

    attributeChangedCallback(name: string, before: string | null, after: string | null): void {
      if (before === after || this.#core === undefined || !this.isConnected) return;
      if (name === 'src' && after !== null) void this.#core.fetch(after);
      // controls redraws the deck with or without its chrome; start applies at the next load
      if (name === 'controls') this.#core.draw();
    }

    /** Open `bytes` (the bytes of a `.flux`) in the element. */
    load(bytes: Uint8Array): Promise<void> {
      return this.#need().load(bytes);
    }

    /** Go to the next screen, or the next build group of this one. */
    next(): void {
      this.#core?.next();
    }

    /** Go back. */
    prev(): void {
      this.#core?.prev();
    }

    /** Go to a screen: its number among the visible screens (from 1) or its id, after `group` of its build groups. */
    goTo(screen: number | string, group = 0): void {
      this.#core?.goTo(screen, group);
    }

    /** Where the presentation is now, or nothing before a file is drawn. */
    get position(): PlayerPosition | undefined {
      return this.#core?.position();
    }

    /** The core, made if `load` is called before the element is in a page. */
    #need(): PlayerCore {
      this.#core ??= new PlayerCore(this.#port(), open, this.#stage());
      return this.#core;
    }

    #port(): Host {
      return {
        attribute: (name) => this.getAttribute(name),
        emit: (type, detail) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })),
      };
    }

    /** The shadow root with its styles, and the stage in it. */
    #stage(): HTMLElement {
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      const made = sheet();
      if (made instanceof CSSStyleSheet) shadow.adoptedStyleSheets = [made];
      else shadow.append(made);
      const stage = document.createElement('div');
      stage.setAttribute('part', 'stage');
      stage.style.cssText = 'position:absolute;inset:0';
      shadow.append(stage);
      return stage;
    }
  };
}

/**
 * Define the element `tag` (default `fluxion-player`) over `open`; a tag that is already defined is left as it is.
 *
 * @public
 */
export function defineFluxionPlayer(open: FluxOpener, tag = 'fluxion-player'): void {
  if (customElements.get(tag) === undefined) customElements.define(tag, makeElement(open));
}
