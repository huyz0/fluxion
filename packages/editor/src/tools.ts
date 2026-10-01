// Tools (FR-EDT-003, ADR-0028, 04 §3.2): hand-rolled statecharts. A tool is a root state node whose
// children are its states; handlers return a transition as plain data, so a tool is tested by feeding
// it PointerInfo streams with no DOM. The dispatcher sends every input to the current state; switching
// tools and Esc are its `use` and `escape`, which the keymap's commands call (M7.4: a tool's shortcut
// is a keymap binding). On Esc a state returns to its tool's start, and a tool at its start returns to
// `select`.
import { createRegistry, type ReadView, type Registry } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import type { ShapeDefs } from './param-handles.js';
import type { Execute, PointerInfo } from './pointer.js';
import type { MarqueeMode } from './selection.js';
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
  /**
   * What a click at page point `p` picks on the canvas's screen, at the current zoom: the topmost
   * drawn element, or the outermost group it sits in.
   */
  hitTest(p: Vec2): RecordId | undefined;
  /** The selectable elements of the canvas's screen a page box contains, or touches, back to front. */
  elementsIn(box: Box, mode: MarqueeMode): readonly RecordId[];
  /** Every selectable element of the canvas's screen inside no other one, back to front. */
  allElements(): readonly RecordId[];
  /** The document, to read. */
  readonly view: ReadView;
  /** The canvas's screen, where creation tools add elements; undefined without one. */
  readonly screen: RecordId | undefined;
  /** Where shape definitions are looked up (parametric handles; absent: a shape shows none). */
  readonly shapeDefs?: ShapeDefs | undefined;
  /** A fresh record id (a duplicate's, a new element's). */
  newId(): RecordId;
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
  /** A key went down (before a tool's shortcut, after the keymap's other bindings). */
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
  /** The modes it works in (default: edit only); the laser works in present mode. */
  readonly modes?: readonly ToolMode[];
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
 * The editor's modes a tool works in: editing, or presenting in place.
 *
 * @public
 */
export type ToolMode = 'edit' | 'present';

/** Whether `tool` works in `mode`. */
const inMode = (tool: Tool | undefined, mode: ToolMode): tool is Tool => tool !== undefined && (tool.modes ?? ['edit']).includes(mode);

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
  /** A key press for the current state (before a tool shortcut, after other bindings); true when its handler took it. */
  key(e: KeyInfo): boolean;
  /** Esc: the state's cancel, else back to the tool's start, else to `select`; always taken. */
  escape(): boolean;
  /** Switch to the tool `id`; false when there is none of that id in this mode. */
  use(id: string): boolean;
  /** What the tools work with (the keymap's commands act through it too). */
  readonly ctx: ToolCtx;
  /** Cancel what is going on (the window lost focus). */
  cancel(): void;
  /** The current tool's id and state's id, e.g. `hand.panning`. */
  readonly current: string;
  /** The registered tools of its mode, sorted by id. */
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
  readonly #mode: ToolMode;

  constructor(registry: Registry<string, Tool>, ctx: ToolCtx, mode: ToolMode) {
    this.#registry = registry;
    this.#ctx = ctx;
    this.#mode = mode;
  }

  /** The tool the session names if it works in this mode, else select, else this mode's first. */
  #wanted(): Tool | undefined {
    const named = this.#registry.get(this.#ctx.session.tool.get());
    if (inMode(named, this.#mode)) return named;
    const select = this.#registry.get(SELECT_TOOL);
    return inMode(select, this.#mode) ? select : this.list()[0];
  }

  #enter(tool: Tool | undefined, id: string, info?: unknown): void {
    this.#state?.onExit?.(this.#ctx);
    this.#tool = tool;
    this.#state = tool?.states[id];
    this.#state?.onEnter?.(this.#ctx, info);
  }

  /** Start the tool the session names, if it is not the current one (the toolbar, another view). */
  #sync(): void {
    const wanted = this.#wanted();
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
    const own = this.#state?.onKeyDown?.(this.#ctx, e);
    if (own === undefined) return false;
    this.#go(own);
    return true;
  }

  escape(): boolean {
    this.#sync();
    this.#escape();
    return true;
  }

  use(id: string): boolean {
    this.#sync();
    if (!inMode(this.#registry.get(id), this.#mode)) return false;
    this.#switchTo(id);
    return true;
  }

  get ctx(): ToolCtx {
    return this.#ctx;
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
    return this.#registry
      .list()
      .map(([, t]) => t)
      .filter((t) => inMode(t, this.#mode));
  }
}

/**
 * A dispatcher over the tools of `registry` that work in `mode` (default `edit`), for the tool
 * `ctx.session.tool` names; an unknown tool, or one of another mode, falls back to `select` (in present
 * mode, to its first tool). Every input first starts that tool, entering its first state on first use.
 *
 * @public
 */
export function createToolDispatcher(registry: Registry<string, Tool>, ctx: ToolCtx, mode: ToolMode = 'edit'): ToolDispatcher {
  return new Dispatcher(registry, ctx, mode);
}
