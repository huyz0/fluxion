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

/** The dispatcher: the current tool and state, and how input moves between them. */
class Dispatcher implements ToolDispatcher {
  #tool: Tool | undefined;
  #state: StateNode | undefined;
  readonly #registry: Registry<string, Tool>;
  readonly #ctx: ToolCtx;

  constructor(registry: Registry<string, Tool>, ctx: ToolCtx) {
    this.#registry = registry;
    this.#ctx = ctx;
  }

  #enter(tool: Tool | undefined, id: string, info?: unknown): void {
    this.#state?.onExit?.(this.#ctx);
    this.#tool = tool;
    this.#state = tool?.states[id];
    this.#state?.onEnter?.(this.#ctx, info);
  }

  /** Start the tool the session names, if it is not the current one (the toolbar, another view). */
  #sync(): void {
    const wanted = this.#registry.get(this.#ctx.session.tool.get()) ?? this.#registry.get(SELECT_TOOL);
    if (wanted === this.#tool) return;
    // what the last tool hovered is not the new one's (M6.11 review F1)
    this.#ctx.session.hover.set(undefined);
    // tzap disable next-line StringLiteral: without a tool there is no state, whatever the id
    this.#enter(wanted, wanted?.initial ?? '');
  }

  #go(t: Transition | undefined): void {
    if (t !== undefined) this.#enter(this.#tool, t.to, t.info);
  }

  /** Switch to tool `id`, cancelling a gesture under way first. */
  #switchTo(id: string): void {
    this.#go(this.#state?.onCancel?.(this.#ctx));
    this.#ctx.session.tool.set(id);
    this.#sync();
  }

  /** Esc: the state's own cancel; else back to the tool's start; from the start, to `select`. */
  #escape(): void {
    const back = this.#state?.onCancel?.(this.#ctx);
    // tzap disable next-line StringLiteral: without a tool there is no state, whatever the id
    const start: Transition = { to: this.#tool?.initial ?? '' };
    if (back !== undefined) this.#go(back);
    else if (this.#state?.id !== this.#tool?.initial) this.#go(start);
    else this.#switchTo(SELECT_TOOL);
  }

  /** The tool whose shortcut `e` is, if any: an unmodified key. */
  #shortcut(e: KeyInfo): string | undefined {
    if (e.mod || e.alt) return undefined;
    return this.#registry.list().find(([, t]) => t.shortcut === e.key.toLowerCase())?.[0];
  }

  pointer(e: PointerInfo): boolean {
    this.#sync();
    if (e.phase === 'cancel') {
      this.#go(this.#state?.onCancel?.(this.#ctx));
      return true;
    }
    const handler = this.#state?.[HANDLERS[e.phase] as Handler];
    if (handler === undefined) return false;
    this.#go(handler.call(this.#state, this.#ctx, e));
    return true;
  }

  key(e: KeyInfo): boolean {
    this.#sync();
    if (e.key === 'Escape') {
      this.#escape();
      return true;
    }
    const own = this.#state?.onKeyDown?.(this.#ctx, e);
    if (own !== undefined) {
      this.#go(own);
      return true;
    }
    const id = this.#shortcut(e);
    if (id === undefined) return false;
    this.#switchTo(id);
    return true;
  }

  cancel(): void {
    this.#sync();
    this.#go(this.#state?.onCancel?.(this.#ctx));
  }

  get current(): string {
    this.#sync();
    return `${this.#tool?.id ?? ''}.${this.#state?.id ?? ''}`;
  }

  list(): readonly Tool[] {
    return this.#registry.list().map(([, t]) => t);
  }
}

/**
 * A dispatcher over the tools of `registry`, for the tool `ctx.session.tool` names; an unknown tool
 * falls back to `select`. Every input first starts that tool, entering its first state on first use.
 *
 * @public
 */
export function createToolDispatcher(registry: Registry<string, Tool>, ctx: ToolCtx): ToolDispatcher {
  return new Dispatcher(registry, ctx);
}
