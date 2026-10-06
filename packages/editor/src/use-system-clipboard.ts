// The editor's hold on the system clipboard (FR-EDT-007, ADR-0020, M7.22): the window's copy, cut and paste events
// (what Ctrl/Cmd+C, X and V fire) and the async path the menu commands use. A copy puts the payload on the system
// clipboard in every representation at once; a paste reads it back, from this document, another or another tab,
// and hands it to the editor's own clipboard so the paste command places it. Events in a text field, while a dialog
// is open or while presenting are the browser's own. An engine that raises no event for the chord on the canvas (WebKit 26.5, M11.59) is answered by the async path after a short wait.
import { useCallback, useEffect, useRef } from 'react';
import type { Clipboard } from './clipboard.js';
import { type ChordFallback, chordAction, chordFallback, type Timers } from './clipboard-chord.js';
import { readAsync, readFromEvent, writeAsync, writeToEvent } from './clipboard-dom.js';
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
type PasteEnv = Pick<SystemClipboardInput, 'clipboard' | 'run' | 'place' | 'notify'>;

/** A paste event that is the editor's: Fluxion's payload first, else an image, an SVG or text. */
function pasteEvent(e: ClipboardEvent, data: DataTransfer, env: PasteEnv): void {
  const read = readFromEvent(data);
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

/** The chord fallback of one editor: made once and kept for its lifetime, so a re-render never drops a chord that is waiting for its event. */
function useChordFallback(commands: { readonly current: SystemClipboardCommands | undefined }): ChordFallback {
  const ref = useRef<ChordFallback | undefined>(undefined);
  ref.current ??= chordFallback(windowTimers, (action) => void commands.current?.[action]());
  const fallback = ref.current;
  useEffect(() => () => fallback.cancel(), [fallback]);
  return fallback;
}

/** Listen for the clipboard events while mounted; the menu commands over the async API. */
export function useSystemClipboard(input: SystemClipboardInput): SystemClipboardCommands {
  const { clipboard, session, run, paused, place, notify } = input;
  // the menu commands below, for the chords the browser raises no event for
  const commandsRef = useRef<SystemClipboardCommands | undefined>(undefined);
  const fallback = useChordFallback(commandsRef);
  useEffect(() => {
    // not the editor's: a field's own copy and paste, a dialog, presenting
    const editingHere = (target: EventTarget | null) => !paused && session.mode.get() === 'edit' && !isEditable(target);
    const own = (e: ClipboardEvent) => e.clipboardData !== null && editingHere(e.target);
    const out = (command: string) => (e: ClipboardEvent) => {
      fallback.answered();
      const payload = own(e) && run(command) ? clipboard.get() : undefined;
      if (payload === undefined || e.clipboardData === null) return;
      clipboard.adopt(payload, writeToEvent(e.clipboardData, payload));
      e.preventDefault();
    };
    const onCopy = out('clipboard.copy');
    const onCut = out('clipboard.cut');
    const onPaste = (e: ClipboardEvent) => {
      fallback.answered();
      if (own(e) && e.clipboardData !== null) pasteEvent(e, e.clipboardData, { clipboard, run, place, notify });
    };
    // a chord the browser answers with an event is done by that event; one it does not is done here after a short wait
    const onKeyDown = (e: KeyboardEvent) => {
      const action = chordAction(e);
      if (action !== undefined && !e.defaultPrevented && editingHere(e.target)) fallback.pressed(action);
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
  }, [clipboard, session, run, paused, place, notify, fallback]);
  // the last write was refused: the system clipboard holds something older, which a paste must not mistake for this copy
  const refused = useRef(false);
  const send = useCallback(
    async (command: string) => {
      const payload = run(command) ? clipboard.get() : undefined;
      if (payload !== undefined) refused.current = !(await writeAsync(payload));
    },
    [clipboard, run],
  );
  const commands: SystemClipboardCommands = {
    copy: () => send('clipboard.copy'),
    cut: () => send('clipboard.cut'),
    paste: async () => {
      // a read nobody answers (no permission, no gesture) must not hold the paste: the editor's own copy is pasted after a moment
      const read = refused.current ? undefined : await readWithin();
      if (read?.parsed.ok === true) clipboard.adopt(read.parsed.payload, read.json);
      run('clipboard.paste');
    },
  };
  commandsRef.current = commands;
  return commands;
}
