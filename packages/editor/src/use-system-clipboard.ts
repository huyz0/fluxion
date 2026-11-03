// The editor's hold on the system clipboard (FR-EDT-007, ADR-0020, M7.22): the window's copy, cut and paste events
// (what Ctrl/Cmd+C, X and V fire) and the async path the menu commands use. A copy puts the payload on the system
// clipboard in every representation at once; a paste reads it back, from this document, another or another tab,
// and hands it to the editor's own clipboard so the paste command places it. Events in a text field, while a dialog
// is open or while presenting are the browser's own. A chord goes through a hidden editable target (clipboard-catcher.ts), since an engine may raise the event only from one
// (WebKit 26.5, M18.132); a chord no event answers all the same is done by the async path after a short wait (M11.59).
// That engine keeps only a copy's text/plain, so the newest copy of the origin's editor pages is shared and a paste of exactly its text is that copy (ADR-0213, M18.242).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Clipboard, ClipboardPayload } from './clipboard.js';
import { type ClipboardCatcher, catchesFrom, clipboardCatcher } from './clipboard-catcher.js';
import { type ChordFallback, chordAction, chordFallback, type Timers } from './clipboard-chord.js';
import { readAsync, readFromEvent, writeAsync, writeToEvent } from './clipboard-dom.js';
import { parsePayload, payloadJson, payloadText } from './clipboard-format.js';
import { type ClipboardShare, clipboardShare, SHARE_CHANNEL, sameText } from './clipboard-share.js';
import { isEditable } from './editor-keys.js';
import { readImageFile } from './image-file.js';
import { isImageFile } from './place-images.js';
import type { Session } from './session.js';
import type { SystemItem } from './system-paste.js';
import { pastedKind, readSystemItem } from './system-paste-dom.js';

/** What the hook reads. */
export type SystemClipboardInput = {
  /** The editor's clipboard. */
  readonly clipboard: Clipboard;
  /** The session (its mode: only editing handles clipboard events). */
  readonly session: Session;
  /** Runs an editor command by id; true when it acted. */
  readonly run: (command: string) => boolean;
  /** A dialog is open: the events are not the editor's. */
  readonly paused: boolean;
  /** Place something pasted that is not Fluxion's (an image, an SVG, text) in the document. */
  readonly place: (item: SystemItem) => void;
  /** Tell the person something (a pasted image that was refused). */
  readonly notify: (message: string) => void;
};

/**
 * Read what a paste carries that is not Fluxion's, after the event ends. An image file goes through the import pipeline (scaled, re-encoded, sniffed)
 * and a refusal is said; an SVG or text is read as before. Called synchronously by the paste handler: the files are taken before it returns.
 */
function pasteForeign(data: DataTransfer, kind: 'image' | 'svg' | 'text', place: (item: SystemItem) => void, notify: (message: string) => void): void {
  if (kind === 'image') {
    const file = [...data.files].find(isImageFile);
    if (file !== undefined) void readImageFile(file).then((read) => (read.ok ? place(read.item) : notify(read.message)));
    return;
  }
  void readSystemItem(data, kind).then((item) => {
    if (item !== undefined) place(item);
  });
}

/** What a paste event's handler uses. */
type PasteEnv = Pick<SystemClipboardInput, 'clipboard' | 'run' | 'place' | 'notify'> & { readonly share: ClipboardShare };

/**
 * The newest copy of the origin's editor pages, when a paste carries no payload of Fluxion's but exactly the text that copy put on the clipboard: an engine
 * that keeps only text/plain (WebKit 26.5, M18.242) drops the custom type and the HTML. A file on the clipboard is something else's.
 */
function sharedCopy(data: DataTransfer, share: ClipboardShare): { readonly json: string; readonly parsed: ReturnType<typeof parsePayload> } | undefined {
  const copy = share.latest();
  // the engine drops the HTML with the custom type; a clipboard whose HTML is there is another application's
  if (copy === undefined || data.files.length > 0 || data.getData('text/html') !== '' || !sameText(data.getData('text/plain'), copy.text)) return undefined;
  return { json: copy.json, parsed: parsePayload(copy.json) };
}

/** A paste event that is the editor's: Fluxion's payload first, else an image, an SVG or text. */
function pasteEvent(e: ClipboardEvent, data: DataTransfer, env: PasteEnv): void {
  const read = readFromEvent(data) ?? sharedCopy(data, env.share);
  // a payload that fails validation is not used: the next representation is tried (ADR-0020), an image, an SVG, text
  if (read?.parsed.ok === true) {
    e.preventDefault();
    env.clipboard.adopt(read.parsed.payload, read.json);
    env.run('clipboard.paste');
    return;
  }
  const kind = pastedKind(data);
  if (kind === undefined) return;
  // taken now, read after: a paste event ends with this handler, and the bytes of a file arrive later
  e.preventDefault();
  pasteForeign(data, kind, env.place, env.notify);
}

/** How long a paste waits for the async clipboard read before it pastes what the editor holds, ms. */
const READ_WAIT_MS = 400;

/** The system clipboard's payload, or undefined when it holds none or the read is not answered within {@link READ_WAIT_MS}. */
function readWithin(): ReturnType<typeof readAsync> {
  return Promise.race([readAsync(), new Promise<undefined>((resolve) => window.setTimeout(resolve, READ_WAIT_MS, undefined))]);
}

/** The menu commands: copy, cut and paste through the async Clipboard API. */
export type SystemClipboardCommands = {
  /** Copy the selection to the system clipboard. */
  copy(): Promise<void>;
  /** Cut the selection to the system clipboard. */
  cut(): Promise<void>;
  /** Paste what the system clipboard holds (the editor's own copy when it holds nothing of Fluxion's). */
  paste(): Promise<void>;
};

const windowTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (handle) => window.clearTimeout(handle as number) };

/** The chord fallback and catcher of one editor: made once and kept for its lifetime, so a re-render never drops a chord that is waiting for its event. */
function useChordFallback(commands: { readonly current: SystemClipboardCommands | undefined }): ChordFallback & { readonly catcher: ClipboardCatcher } {
  const ref = useRef<(ChordFallback & { readonly catcher: ClipboardCatcher }) | undefined>(undefined);
  if (ref.current === undefined) {
    const catcher = clipboardCatcher(document);
    const fallback = chordFallback(windowTimers, (action) => {
      catcher.restore();
      void commands.current?.[action]();
    });
    ref.current = { ...fallback, catcher };
  }
  const fallback = ref.current;
  useEffect(
    () => () => {
      fallback.cancel();
      fallback.catcher.dispose();
    },
    [fallback],
  );
  return fallback;
}

/** An event on the catcher is the editor's even when it does nothing: its placeholder is never copied, cut or pasted into, and the focus goes back. */
function settle(e: ClipboardEvent, catcher: ClipboardCatcher): void {
  if (!catcher.owns(e.target)) return;
  e.preventDefault();
  catcher.restore();
}

/** Whether no control marked to keep its focus has it; one that has is left the chords pressed on it, whose events Firefox raises on the body (M18.227). */
const free = (): boolean => catchesFrom(document.activeElement);

/**
 * The page's share of the newest copy (ADR-0213), opened while mounted: a remount (React's StrictMode does one) opens a new channel rather than
 * keeping a closed one. The object returned is stable and reaches whichever share is open; between mounts a copy is just not told.
 */
function useClipboardShare(): ClipboardShare {
  const current = useRef<ClipboardShare | undefined>(undefined);
  const [share] = useState<ClipboardShare>(() => ({
    copied: (json, text) => current.current?.copied(json, text),
    latest: () => current.current?.latest(),
    dispose: () => undefined,
  }));
  useEffect(() => {
    const open = clipboardShare(typeof BroadcastChannel === 'function' ? new BroadcastChannel(SHARE_CHANNEL) : undefined, Date.now);
    current.current = open;
    return () => {
      open.dispose();
      if (current.current === open) current.current = undefined;
    };
  }, []);
  return share;
}

/** Put a copy on the event's clipboard, hold it as the editor's, and tell the other pages (ADR-0213). */
function putOnEvent(data: DataTransfer, payload: ClipboardPayload, clipboard: Clipboard, share: ClipboardShare): void {
  const json = writeToEvent(data, payload);
  clipboard.adopt(payload, json);
  share.copied(json, payloadText(payload));
}

/** The menu commands over the async Clipboard API; each copy is told to the other pages (ADR-0213). */
function useMenuCommands(clipboard: Clipboard, run: (command: string) => boolean, share: ClipboardShare): SystemClipboardCommands {
  // the last write was refused: the system clipboard holds something older, which a paste must not mistake for this copy
  const refused = useRef(false);
  const send = useCallback(
    async (command: string) => {
      const payload = run(command) ? clipboard.get() : undefined;
      if (payload === undefined) return;
      share.copied(payloadJson(payload), payloadText(payload));
      refused.current = !(await writeAsync(payload));
    },
    [clipboard, run, share],
  );
  return {
    copy: () => send('clipboard.copy'),
    cut: () => send('clipboard.cut'),
    paste: async () => {
      // a read nobody answers (no permission, no gesture) must not hold the paste: the editor's own copy is pasted after a moment
      const read = refused.current ? undefined : await readWithin();
      if (read?.parsed.ok === true) clipboard.adopt(read.parsed.payload, read.json);
      run('clipboard.paste');
    },
  };
}

/** Listen for the clipboard events while mounted; the menu commands over the async API. */
export function useSystemClipboard(input: SystemClipboardInput): SystemClipboardCommands {
  const { clipboard, session, run, paused, place, notify } = input;
  // the menu commands below, for the chords the browser raises no event for
  const commandsRef = useRef<SystemClipboardCommands | undefined>(undefined);
  const fallback = useChordFallback(commandsRef);
  const share = useClipboardShare();
  // on before the editor is painted (a layout effect, not a passive one, which React may run after the paint): a chord pressed as soon as the
  // editor shows is routed, not lost to a page with no listener (M18.257, ci 41625372038)
  useLayoutEffect(() => {
    const { catcher } = fallback;
    // not the editor's: a field's own copy and paste, a dialog, presenting; the catcher is a field only the editor's chords reach
    const editingHere = (target: EventTarget | null) => !paused && session.mode.get() === 'edit' && (catcher.owns(target) || (!isEditable(target) && free()));
    const own = (e: ClipboardEvent) => e.clipboardData !== null && editingHere(e.target);
    const caught = (e: ClipboardEvent) => settle(e, catcher);
    const out = (command: string) => (e: ClipboardEvent) => {
      fallback.answered();
      const payload = own(e) && run(command) ? clipboard.get() : undefined;
      if (payload !== undefined && e.clipboardData !== null) {
        putOnEvent(e.clipboardData, payload, clipboard, share);
        e.preventDefault();
      }
      caught(e);
    };
    const onCopy = out('clipboard.copy');
    const onCut = out('clipboard.cut');
    const onPaste = (e: ClipboardEvent) => {
      fallback.answered();
      if (own(e) && e.clipboardData !== null) pasteEvent(e, e.clipboardData, { clipboard, run, place, notify, share });
      caught(e);
    };
    // a chord goes through the catcher, so the browser raises its event from an editable target; one it answers with no event is done here after a short wait
    const onKeyDown = (e: KeyboardEvent) => {
      const action = chordAction(e);
      if (action === undefined || e.defaultPrevented || !editingHere(e.target)) return;
      // a chord still waiting is done (and the focus given back) first, then this one is routed; a copy or cut of the page's selected text,
      // with nothing selected on the canvas, is the browser's own and goes where it went before, and a control marked to keep its focus keeps it (M18.144)
      fallback.pressed(action);
      const pageText = action !== 'paste' && session.selection.get().length === 0 && document.getSelection()?.isCollapsed === false;
      if (!pageText && (catcher.owns(e.target) || catchesFrom(e.target))) catcher.route();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [clipboard, session, run, paused, place, notify, fallback, share]);
  const commands = useMenuCommands(clipboard, run, share);
  commandsRef.current = commands;
  return commands;
}
