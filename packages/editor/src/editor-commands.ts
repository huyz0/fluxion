// Editor commands (FR-EDT-011, FR-EDT-012): the editor's own actions, by id, that the keymap binds and
// the command palette and context menus list (M7.24, M7.25). Distinct from the document's commands
// (`core`), which change the document: an editor command may run one of those through the tools'
// `execute`, or act on the session (camera, tool, selection, mode). Each returns whether it acted, so
// a key it declines stays the tools' (or the browser's).
import type { Camera } from './camera.js';
import { type CameraStep, cameraStep, type FitTargets } from './canvas-input.js';
import { EDIT_FLAGS, type KeyBinding, type KeyPress, PRESENT_FLAGS, resolveKey } from './keymap.js';
import { deleteSelection, nudgeSelection, selectAll } from './select-tool.js';
import { editSelectedText } from './text-edit.js';
import { SELECT_TOOL, type ToolDispatcher } from './tools.js';

/**
 * A canvas's size, in screen px.
 *
 * @public
 */
export type CanvasSize = {
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
};

/**
 * The canvas a camera command acts in.
 *
 * @public
 */
export type CommandCanvas = {
  /** Its size. */
  readonly viewport: CanvasSize;
  /** What the fits fit, read when a fit runs. */
  targets(): FitTargets;
};

/**
 * What an editor command acts on. Only `tools` is always there; a command whose part is missing (a
 * canvas without a size, a host without present mode) declines.
 *
 * @public
 */
export type EditorCommandCtx = {
  /** The current mode. */
  readonly mode: 'edit' | 'present';
  /** The current mode's tools, and through `tools.ctx` the session and the document. */
  readonly tools: ToolDispatcher;
  /** The document's undo history. */
  readonly history?: CommandHistory;
  /** The canvas camera commands act in. */
  readonly canvas?: CommandCanvas;
  /** Switch between editing and presenting in place. */
  switchMode?(): void;
  /** Open the keyboard shortcuts dialog. */
  openHelp?(): void;
  /** Show the view an undone or redone entry's meta holds again. */
  restoreView?(meta: unknown): void;
};

/**
 * The undo history an editor command steps through.
 *
 * @public
 */
export type CommandHistory = {
  /** Undo the last step; its result carries the entry's meta. */
  undo(): HistoryResult;
  /** Redo the last undone step; its result carries the entry's meta. */
  redo(): HistoryResult;
};

/**
 * What a history step answers: whether it ran, and the entry's meta (the view to show again).
 *
 * @public
 */
export type HistoryResult = {
  /** Whether the step ran. */
  readonly ok: boolean;
  /** The entry's meta when it ran: the view to show again. */
  readonly value?: unknown;
};

/**
 * An editor action: its id, title, and what it does.
 *
 * @public
 */
export type EditorCommand = {
  /** The id bindings name, e.g. `history.undo`. */
  readonly id: string;
  /** Its title (the palette's, the cheat sheet's). */
  readonly title: string;
  /** Run it with `args`; true when it acted. */
  run(ctx: EditorCommandCtx, args?: unknown): boolean;
};

/** An undo or redo that ran shows the entry's view again; true, as the key was the history's either way. */
function step(ctx: EditorCommandCtx, result: HistoryResult): boolean {
  if (result.ok) ctx.restoreView?.(result.value);
  return true;
}

/** The select tool's idle state: where the selection keys act (as in M6, not mid-gesture or in another tool). */
const selectIdle = (ctx: EditorCommandCtx) => ctx.tools.current === `${SELECT_TOOL}.idle`;

/** Set the camera to `next` when there is one; true when it moved. */
function setCamera(ctx: EditorCommandCtx, next: (camera: Camera) => Camera | undefined): boolean {
  const session = ctx.tools.ctx.session;
  const camera = next(session.camera.get());
  if (camera === undefined) return false;
  session.camera.set(camera);
  return true;
}

/** A camera command: its step, in a canvas with a size and a screen to show. */
const cameraCommand = (id: string, title: string, step: CameraStep): EditorCommand => ({
  id,
  title,
  run: (ctx) => {
    const canvas = ctx.canvas;
    const targets = canvas?.targets();
    if (canvas === undefined || targets?.screen === undefined || canvas.viewport.w === 0) return false;
    return setCamera(ctx, (c) => cameraStep(c, step, canvas.viewport, targets));
  },
});

/** The `{dx, dy}` of a nudge's args, or undefined when they are not numbers. */
function delta(args: unknown): { readonly x: number; readonly y: number } | undefined {
  const a = args as { readonly dx?: unknown; readonly dy?: unknown } | undefined;
  return typeof a?.dx === 'number' && typeof a.dy === 'number' ? { x: a.dx, y: a.dy } : undefined;
}

/**
 * The editor's built-in commands.
 *
 * @public
 */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    id: 'history.undo',
    title: 'Undo',
    run: (ctx) => {
      if (ctx.history === undefined) return false;
      // a gesture under way is cancelled first, so it cannot write over what the undo put back (M6.15 review F3)
      ctx.tools.cancel();
      return step(ctx, ctx.history.undo());
    },
  },
  {
    id: 'history.redo',
    title: 'Redo',
    run: (ctx) => {
      if (ctx.history === undefined) return false;
      ctx.tools.cancel();
      return step(ctx, ctx.history.redo());
    },
  },
  cameraCommand('camera.zoomIn', 'Zoom in', 'zoomIn'),
  cameraCommand('camera.zoomOut', 'Zoom out', 'zoomOut'),
  cameraCommand('camera.zoom100', 'Zoom to 100 %', 'zoom100'),
  cameraCommand('camera.fitScreen', 'Zoom to fit the screen', 'fitScreen'),
  cameraCommand('camera.fitSelection', 'Zoom to the selection', 'fitSelection'),
  { id: 'tool.escape', title: 'Cancel', run: (ctx) => ctx.tools.escape() },
  {
    id: 'tool.use',
    title: 'Use a tool',
    run: (ctx, args) => {
      const id = (args as { readonly id?: unknown } | undefined)?.id;
      return typeof id === 'string' && ctx.tools.use(id);
    },
  },
  {
    id: 'selection.nudge',
    title: 'Nudge the selection',
    run: (ctx, args) => {
      const d = delta(args);
      return d !== undefined && selectIdle(ctx) && nudgeSelection(ctx.tools.ctx, d);
    },
  },
  {
    id: 'selection.all',
    title: 'Select all',
    run: (ctx) => {
      if (!selectIdle(ctx)) return false;
      selectAll(ctx.tools.ctx);
      return true;
    },
  },
  { id: 'selection.delete', title: 'Delete the selection', run: (ctx) => selectIdle(ctx) && deleteSelection(ctx.tools.ctx) },
  {
    id: 'text.edit',
    title: 'Edit the text',
    run: (ctx) => selectIdle(ctx) && editSelectedText(ctx.tools.ctx.session, ctx.tools.ctx.view),
  },
  {
    id: 'help.keys',
    title: 'Keyboard shortcuts',
    run: (ctx) => {
      if (ctx.openHelp === undefined) return false;
      ctx.openHelp();
      return true;
    },
  },
  {
    id: 'mode.toggle',
    title: 'Present / stop presenting',
    run: (ctx) => {
      if (ctx.switchMode === undefined) return false;
      ctx.switchMode();
      return true;
    },
  },
];

/**
 * The key press `k` dispatched: the binding it resolves to in `bindings` for the mode runs its command
 * from `commands`; a key no binding takes (or whose command declines) goes to the current tool state.
 * A tool's shortcut (`tool.use`) is the one binding that yields: the current state's own keys come
 * first (a state using a letter mid-gesture keeps it), as in M6. True when something took it.
 *
 * @public
 */
export function dispatchKey(k: KeyPress, bindings: readonly KeyBinding[], commands: ReadonlyMap<string, EditorCommand>, ctx: EditorCommandCtx): boolean {
  const binding = resolveKey(bindings, k, ctx.mode === 'present' ? PRESENT_FLAGS : EDIT_FLAGS);
  const command = binding === undefined ? undefined : commands.get(binding.command);
  const run = () => command?.run(ctx, binding?.args) === true;
  if (binding?.command === 'tool.use') return ctx.tools.key(k) || run();
  return run() || ctx.tools.key(k);
}

/**
 * `commands` by id.
 *
 * @public
 */
export const commandMap = (commands: readonly EditorCommand[] = EDITOR_COMMANDS): ReadonlyMap<string, EditorCommand> => new Map(commands.map((c) => [c.id, c]));
