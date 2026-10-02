// The editor's one window key dispatcher (FR-EDT-012, M7.4): a key press becomes a chord, the keymap
// resolves it for the mode (edit or present) to an editor command, and a key no binding takes goes to
// the current tool state. It replaces the hard-wired keys M6 kept in the canvas, the tools and present
// mode (M6 cp1 F6). Space held for panning stays the canvas's: a hold, not a command.
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { useCallback, useEffect, useRef } from 'react';
import type { Clipboard } from './clipboard.js';
import { type CanvasSize, commandMap, dispatchKey, EDITOR_COMMANDS, type EditorCommandCtx } from './editor-commands.js';
import { DEFAULT_KEYMAP, type KeyPress, toolBindings } from './keymap.js';
import { applyOverrides, type KeyOverrides } from './keymap-overrides.js';
import { placements, selectionBounds } from './overlay-geometry.js';
import type { Session } from './session.js';
import type { ToolDispatcher } from './tools.js';

/**
 * Whether `target` takes text (keys typed there are not the editor's).
 *
 * @public
 */
export function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Enter on a focused button or link is its click, not an edit of the selection. */
const clicks = (e: KeyboardEvent): boolean => e.key === 'Enter' && e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName);

/**
 * Input of {@link useEditorKeys}.
 *
 * @public
 */
export type EditorKeysInput = {
  /** The document store (its history, and the selection's bounds for shift + 2). */
  readonly store: Store;
  /** The session: its mode picks the tools and the bindings. */
  readonly session: Session;
  /** The edit-mode tools. */
  readonly tools: ToolDispatcher;
  /** The present-mode tools, when the host presents in place. */
  readonly present?: ToolDispatcher | undefined;
  /** The canvas's size, in screen px. */
  readonly viewport: CanvasSize;
  /** The shown screen's area on the page, if any. */
  readonly area: Box | undefined;
  /** Switch between editing and presenting, when the host can. */
  readonly switchMode?: (() => void) | undefined;
  /** The user's rebindings, applied over the defaults and the tools' bindings. */
  readonly overrides?: KeyOverrides | undefined;
  /** Open the keyboard shortcuts dialog (`?`). */
  readonly openHelp?: (() => void) | undefined;
  /** Show the view an undone or redone entry holds again. */
  readonly restoreView?: ((meta: unknown) => void) | undefined;
  /** The clipboard copy, cut, paste and duplicate use. */
  readonly clipboard?: Clipboard | undefined;
  /** Keys are not the editor's while a dialog is open. */
  readonly paused?: boolean | undefined;
};

const COMMANDS = commandMap(EDITOR_COMMANDS);

/** The key press of the event `e`. */
export const pressOf = (e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): KeyPress => ({
  key: e.key,
  code: e.code,
  mod: e.ctrlKey || e.metaKey,
  shift: e.shiftKey,
  alt: e.altKey,
});

/** What the editor's commands act on at a key press, in the session's mode. */
function commandCtx(input: EditorKeysInput): EditorCommandCtx {
  const { store, session, tools, present, viewport, area, switchMode, openHelp, restoreView, clipboard } = input;
  const presenting = session.mode.get() === 'present' && present !== undefined;
  return {
    mode: presenting ? 'present' : 'edit',
    tools: presenting ? present : tools,
    history: store.history,
    // read at the key press: the selection's bounds for shift + 2
    canvas: { viewport, targets: () => ({ screen: area, selection: selectionBounds(placements(store, session.selection.get())) }) },
    ...(switchMode === undefined ? {} : { switchMode }),
    ...(openHelp === undefined ? {} : { openHelp }),
    ...(restoreView === undefined ? {} : { restoreView }),
    ...(clipboard === undefined ? {} : { clipboard }),
  };
}

/**
 * Dispatch the window's key presses through the keymap while mounted; a key typed into a field, or
 * taken already (a tab list's or splitter's arrows, space held by the canvas), is left alone. Returns
 * a function that runs an editor command by id as the keys would (the toolbar's buttons, and later
 * the palette and menus); true when it acted.
 *
 * @public
 */
export function useEditorKeys(input: EditorKeysInput): (command: string, args?: unknown) => boolean {
  const latest = useRef(input);
  latest.current = input;
  const run = useCallback((command: string, args?: unknown) => COMMANDS.get(command)?.run(commandCtx(latest.current), args) === true, []);
  const { store, session, tools, present, viewport, area, switchMode, openHelp, restoreView, clipboard, overrides, paused } = input;
  useEffect(() => {
    if (paused === true) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // F5 is taken in a field too: it would reload the page, losing the document (M7.4 review F2)
      if (e.defaultPrevented || (isEditable(e.target) && e.key !== 'F5')) return;
      if (clicks(e)) return;
      const ctx = commandCtx({ store, session, tools, present, viewport, area, switchMode, openHelp, restoreView, clipboard });
      const keymap = applyOverrides([...DEFAULT_KEYMAP, ...toolBindings(ctx.tools.list())], overrides ?? {});
      if (dispatchKey(pressOf(e), keymap, COMMANDS, ctx)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, session, tools, present, viewport, area, switchMode, openHelp, restoreView, clipboard, overrides, paused]);
  return run;
}
