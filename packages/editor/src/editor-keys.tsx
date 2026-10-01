// The editor's one window key dispatcher (FR-EDT-012, M7.4): a key press becomes a chord, the keymap
// resolves it for the mode (edit or present) to an editor command, and a key no binding takes goes to
// the current tool state. It replaces the hard-wired keys M6 kept in the canvas, the tools and present
// mode (M6 cp1 F6). Space held for panning stays the canvas's: a hold, not a command.
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { useEffect } from 'react';
import { type CanvasSize, commandMap, dispatchKey, EDITOR_COMMANDS, type EditorCommandCtx } from './editor-commands.js';
import { DEFAULT_KEYMAP, type KeyBinding, type KeyPress, toolBindings } from './keymap.js';
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
  /** Bindings after the defaults and the tools' (later ones win). */
  readonly bindings?: readonly KeyBinding[] | undefined;
};

const COMMANDS = commandMap(EDITOR_COMMANDS);

/** The key press of the event `e`. */
const pressOf = (e: KeyboardEvent): KeyPress => ({ key: e.key, code: e.code, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });

/** What the editor's commands act on at a key press, in the session's mode. */
function commandCtx(input: EditorKeysInput): EditorCommandCtx {
  const { store, session, tools, present, viewport, area, switchMode } = input;
  const presenting = session.mode.get() === 'present' && present !== undefined;
  return {
    mode: presenting ? 'present' : 'edit',
    tools: presenting ? present : tools,
    history: store.history,
    // read at the key press: the selection's bounds for shift + 2
    canvas: { viewport, targets: () => ({ screen: area, selection: selectionBounds(placements(store, session.selection.get())) }) },
    ...(switchMode === undefined ? {} : { switchMode }),
  };
}

/**
 * Dispatch the window's key presses through the keymap while mounted; a key typed into a field, or
 * taken already (a tab list's or splitter's arrows, space held by the canvas), is left alone.
 *
 * @public
 */
export function useEditorKeys(input: EditorKeysInput): void {
  const { store, session, tools, present, viewport, area, switchMode, bindings } = input;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // F5 is taken in a field too: it would reload the page, losing the document (M7.4 review F2)
      if (e.defaultPrevented || (isEditable(e.target) && e.key !== 'F5')) return;
      const ctx = commandCtx({ store, session, tools, present, viewport, area, switchMode });
      const keymap = [...DEFAULT_KEYMAP, ...toolBindings(ctx.tools.list()), ...(bindings ?? [])];
      if (dispatchKey(pressOf(e), keymap, COMMANDS, ctx)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, session, tools, present, viewport, area, switchMode, bindings]);
}
