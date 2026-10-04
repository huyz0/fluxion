// The editor's hold on the system clipboard (FR-EDT-007, ADR-0020, M7.22): the window's copy, cut and paste events
// (what Ctrl/Cmd+C, X and V fire) and the async path the menu commands use. A copy puts the payload on the system
// clipboard in every representation at once; a paste reads it back, from this document, another or another tab,
// and hands it to the editor's own clipboard so the paste command places it. Events in a text field, while a dialog
// is open or while presenting are the browser's own.
import { useCallback, useEffect, useRef } from 'react';
import type { Clipboard } from './clipboard.js';
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

/** The menu commands: copy, cut and paste through the async Clipboard API. */
export type SystemClipboardCommands = {
  /** Copy the selection to the system clipboard. */
  copy(): Promise<void>;
  /** Cut the selection to the system clipboard. */
  cut(): Promise<void>;
  /** Paste what the system clipboard holds (the editor's own copy when it holds nothing of Fluxion's). */
  paste(): Promise<void>;
};

/** Listen for the clipboard events while mounted; the menu commands over the async API. */
export function useSystemClipboard(input: SystemClipboardInput): SystemClipboardCommands {
  const { clipboard, session, run, paused, place, notify } = input;
  useEffect(() => {
    // not the editor's: a field's own copy and paste, a dialog, presenting
    const own = (e: ClipboardEvent) => !paused && e.clipboardData !== null && session.mode.get() === 'edit' && !isEditable(e.target);
    const out = (command: string) => (e: ClipboardEvent) => {
      const payload = own(e) && run(command) ? clipboard.get() : undefined;
      if (payload === undefined || e.clipboardData === null) return;
      clipboard.adopt(payload, writeToEvent(e.clipboardData, payload));
      e.preventDefault();
    };
    const onCopy = out('clipboard.copy');
    const onCut = out('clipboard.cut');
    const onPaste = (e: ClipboardEvent) => {
      if (!own(e) || e.clipboardData === null) return;
      const data = e.clipboardData;
      const read = readFromEvent(data);
      // a payload that fails validation is not used: the next representation is tried (ADR-0020), an image, an SVG, text
      if (read?.parsed.ok === true) {
        e.preventDefault();
        clipboard.adopt(read.parsed.payload, read.json);
        run('clipboard.paste');
        return;
      }
      const kind = pastedKind(data);
      if (kind === undefined) return;
      // taken now, read after: a paste event ends with this handler, and the bytes of a file arrive later
      e.preventDefault();
      pasteForeign(data, kind, place, notify);
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [clipboard, session, run, paused, place]);
  // the last write was refused: the system clipboard holds something older, which a paste must not mistake for this copy
  const refused = useRef(false);
  const send = useCallback(
    async (command: string) => {
      const payload = run(command) ? clipboard.get() : undefined;
      if (payload !== undefined) refused.current = !(await writeAsync(payload));
    },
    [clipboard, run],
  );
  return {
    copy: () => send('clipboard.copy'),
    cut: () => send('clipboard.cut'),
    paste: async () => {
      const read = refused.current ? undefined : await readAsync();
      if (read?.parsed.ok === true) clipboard.adopt(read.parsed.payload, read.json);
      run('clipboard.paste');
    },
  };
}
