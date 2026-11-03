// The editor's last copy, shared between the editor's pages of one origin (FR-EDT-007, NFR-PORT-001, ADR-0020, M18.242). A copy puts
// Fluxion's payload on the system clipboard in its custom type and in an HTML template, but an engine may keep neither: WebKit 26.5
// (Playwright 1.62.1) keeps only text/plain (clipboard-events-probe, nightly 41612451867). So each page keeps the newest copy made in any
// of its origin's pages: a copy is sent to the others on a BroadcastChannel, and a page that opens asks them for theirs. A paste that
// carries no payload of Fluxion's but the very text that copy put on the clipboard is that copy. Nothing is stored: the copy lives in
// the open pages only, and what arrives is validated like any pasted payload before it is used.
import { MAX_PAYLOAD_CHARS } from './clipboard-format.js';

/** A copy made in one of the origin's editor pages. */
export type SharedCopy = {
  /** The payload JSON (what the custom type carries). */
  readonly json: string;
  /** What the copy put on the clipboard as text/plain. */
  readonly text: string;
  /** When it was made (ms since the epoch): the newest copy is the clipboard's. */
  readonly at: number;
};

/** The channel's part used here (a BroadcastChannel). */
export type ShareChannel = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  close(): void;
};

/** The share of one editor page. */
export type ClipboardShare = {
  /** This page made a copy: it is the newest, and the other pages are told. */
  copied(json: string, text: string): void;
  /** The newest copy made in any open page of the origin that this page has heard of. */
  latest(): SharedCopy | undefined;
  /** Stop listening (the editor goes away). */
  dispose(): void;
};

/** The channel's name. */
export const SHARE_CHANNEL = 'fluxion-clipboard';

/** A copy as it arrives from another page: untrusted until it has the shape of one and fits a payload's bound. */
function copyOf(value: unknown): SharedCopy | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { json, text, at } = value as Record<string, unknown>;
  if (typeof json !== 'string' || typeof text !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  return json.length > MAX_PAYLOAD_CHARS || text.length > MAX_PAYLOAD_CHARS ? undefined : { json, text, at };
}

/** The share over `channel` (none where the browser has no BroadcastChannel: then only this page's copies are known), `now` the clock. */
export function clipboardShare(channel: ShareChannel | undefined, now: () => number): ClipboardShare {
  let newest: SharedCopy | undefined;
  // whether the newest copy is this page's: only its maker answers an ask, so one page sends it, not every page that heard of it
  let mine = false;
  // a channel that was closed under us (the page going away) must not break a copy: the others just do not hear of it
  const post = (message: unknown) => {
    try {
      channel?.postMessage(message);
    } catch {
      // closed: nothing to tell
    }
  };
  const listener = (e: MessageEvent) => {
    // two messages: `{ ask: true }` (a page opened and wants the newest copy) and `{ copy }`
    const message = e.data as { readonly ask?: unknown; readonly copy?: unknown } | null;
    if (message?.ask === true && mine) post({ copy: newest });
    const copy = copyOf(message?.copy);
    // another page's copy replaces ours only when it is newer; its clock is its own, so this page's next copy always wins again
    if (copy !== undefined && (newest === undefined || copy.at >= newest.at)) {
      newest = copy;
      mine = false;
    }
  };
  channel?.addEventListener('message', listener);
  // a page opened after the copy asks the open ones for theirs
  post({ ask: true });
  return {
    copied(json, text) {
      newest = { json, text, at: now() };
      mine = true;
      post({ copy: newest });
    },
    latest: () => newest,
    dispose() {
      channel?.removeEventListener('message', listener);
      channel?.close();
    },
  };
}

/** Whether a paste's text/plain is the text a copy put there (line ends may come back as CRLF). */
export const sameText = (pasted: string, copied: string): boolean => pasted.replace(/\r\n?/g, '\n') === copied.replace(/\r\n?/g, '\n');
