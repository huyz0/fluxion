// Tools (FR-EDT-003, ADR-0028, 04 §3.2): hand-rolled statecharts. A tool is a root state node whose
// children are its states; handlers return a transition as plain data, so a tool is tested by feeding
// it PointerInfo streams with no DOM. The dispatcher sends every input to the current state, switches
// tools by their shortcuts, and on Esc cancels: a state returns to its tool's start, and a tool at its
// start returns to `select`.
import { createRegistry, type Registry } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import type { Execute, PointerInfo } from './pointer.js';
import type { Session } from './session.js';

/**
 * A key press as tools see it.
 *
 * @public
 */
export type KeyInfo = {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** Shift held. */
  readonly shift: boolean;
  /** Alt held. */
  readonly alt: boolean;
  /** Ctrl or meta held. */
  readonly mod: boolean;
};

/**
 * What a tool works with.
 *
 * @public
 */
export type ToolCtx = {
  /** The document's session: selection, camera, tool, hover. */
  readonly session: Session;
  /** The topmost element drawn at page point `p` on the canvas's screen, at the current zoom. */
  hitTest(p: Vec2): RecordId | undefined;
  /** Run a command (the only write path). */
  readonly execute: Execute;
  /** Close the current undo step (at the end of a gesture). */
  seal(): void;
};

/**
 * A move to the state `to` of the same tool, with `info` for its `onEnter`.
 *
 * @public
 */
export type Transition = {
  /** The target state's id. */
  readonly to: string;
  /** Passed to the target's `onEnter`. */
  readonly info?: unknown;
};

/**
 * A state of a tool; every handler is optional and may return a transition.
 *
 * @public
 */
export type StateNode = {
  /** The state's id within its tool. */
  readonly id: string;
  /** On entering the state. */
  onEnter?(ctx: ToolCtx, info?: unknown): void;
  /** On leaving the state. */
  onExit?(ctx: ToolCtx): void;
  /** A pointer went down. */
  onPointerDown?(ctx: ToolCtx, e: PointerInfo): Transition | undefined;
  /** A pointer moved (once per frame). */
  onPointerMove?(ctx: ToolCtx, e: PointerInfo): Transition | undefined;
  /** A pointer went up. */
  onPointerUp?(ctx: ToolCtx, e: PointerInfo): Transition | undefined;
  /** A key went down that no dispatcher rule took. */
  onKeyDown?(ctx: ToolCtx, e: KeyInfo): Transition | undefined;
  /** Esc, a cancelled pointer, the window losing focus. */
  onCancel?(ctx: ToolCtx): Transition | undefined;
};

/**
 * A tool: its states, the one it starts in, and its keyboard shortcut.
 *
 * @public
 */
export type Tool = {
  /** Registry key and `session.tool` value, e.g. `select`. */
  readonly id: string;
  /** Toolbar title. */
  readonly title: string;
  /** The key that switches to it (a single lower-case character), if any. */
  readonly shortcut?: string;
  /** The state it starts in and returns to on Esc. */
  readonly initial: string;
  /** Its states, by id. */
  readonly states: { readonly [id: string]: StateNode };
};

/**
 * The tool every other returns to on Esc.
 *
 * @public
 */
export const SELECT_TOOL = 'select';

/**
 * An empty tools registry.
 *
 * @public
 */
export function createToolRegistry(): Registry<string, Tool> {
  return createRegistry<string, Tool>('tools');
}

/**
 * Sends input to the current tool's current state.
 *
 * @public
 */
export type ToolDispatcher = {
  /** A pointer event; true when a state took it. */
  pointer(e: PointerInfo): boolean;
  /** A key press; true when it was taken (a shortcut, Esc, or a state's handler). */
  key(e: KeyInfo): boolean;
  /** Cancel what is going on (the window lost focus). */
  cancel(): void;
  /** The current tool's id and state's id, e.g. `hand.panning`. */
  readonly current: string;
  /** The registered tools, sorted by id. */
  list(): readonly Tool[];
};

type Handler = 'onPointerDown' | 'onPointerMove' | 'onPointerUp';
const HANDLERS: { readonly [phase: string]: Handler } = { down: 'onPointerDown', move: 'onPointerMove', up: 'onPointerUp' };

/**
 * A dispatcher over the tools of `registry`, for the tool `ctx.session.tool` names; an unknown tool
 * falls back to `select`.
 *
 * @public
 */
export function createToolDispatcher(registry: Registry<string, Tool>, ctx: ToolCtx): ToolDispatcher {
  let tool: Tool | undefined;
  let state: StateNode | undefined;
  const toolNamed = (id: string) => registry.get(id) ?? registry.get(SELECT_TOOL);
  const enter = (t: Tool | undefined, id: string, info?: unknown) => {
    state?.onExit?.(ctx);
    tool = t;
    state = t?.states[id];
    state?.onEnter?.(ctx, info);
  };
  // the session's tool may have changed (the toolbar, another view): start that tool
  const sync = () => {
    const wanted = toolNamed(ctx.session.tool.get());
    // tzap disable next-line StringLiteral: without a tool there is no state, whatever the id
    if (wanted !== tool) enter(wanted, wanted?.initial ?? '');
  };
  const go = (t: Transition | undefined) => {
    if (t === undefined) return;
    enter(tool, t.to, t.info);
  };
  const switchTo = (id: string) => {
    // a gesture under way is cancelled first
    go(state?.onCancel?.(ctx));
    ctx.session.tool.set(id);
    sync();
  };
  const onEscape = () => {
    const back = state?.onCancel?.(ctx);
    if (back !== undefined) return go(back);
    // tzap disable next-line StringLiteral: without a tool there is no state, whatever the id
    if (state?.id !== tool?.initial) return enter(tool, tool?.initial ?? '');
    switchTo(SELECT_TOOL);
  };
  const shortcut = (e: KeyInfo) => (e.mod || e.alt ? undefined : registry.list().find(([, t]) => t.shortcut === e.key.toLowerCase())?.[0]);
  // every input first starts the tool the session names (entering its first state on first use)
  return {
    pointer: (e) => {
      sync();
      if (e.phase === 'cancel') {
        go(state?.onCancel?.(ctx));
        return true;
      }
      const handler = state?.[HANDLERS[e.phase] as Handler];
      if (handler === undefined) return false;
      go(handler.call(state, ctx, e));
      return true;
    },
    key: (e) => {
      sync();
      if (e.key === 'Escape') {
        onEscape();
        return true;
      }
      const own = state?.onKeyDown?.(ctx, e);
      if (own !== undefined) {
        go(own);
        return true;
      }
      const id = shortcut(e);
      if (id === undefined) return false;
      switchTo(id);
      return true;
    },
    cancel: () => {
      sync();
      go(state?.onCancel?.(ctx));
    },
    get current() {
      sync();
      return `${tool?.id ?? ''}.${state?.id ?? ''}`;
    },
    list: () => registry.list().map(([, t]) => t),
  };
}
