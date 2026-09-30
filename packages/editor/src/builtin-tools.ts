// The built-in tools (FR-EDT-003): `select` picks the topmost element under a click (shift toggles
// it), drags a marquee from empty canvas (FR-EDT-004), selects all with ctrl/cmd + A and tracks the
// hovered element (moving and resizing arrive with M6.14-M6.15); `hand` pans with any button.
import type { Registry } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { panBy } from './camera.js';
import { clickSelection, DRAG_PX, marquee, union } from './selection.js';
import { SELECT_TOOL, type Tool } from './tools.js';

/**
 * The select tool.
 *
 * @public
 */
export function selectTool(): Tool {
  // a press on empty canvas: where it started, with shift or not, and what was selected before
  let press: { readonly screen: Vec2; readonly page: Vec2; readonly shift: boolean; readonly before: readonly RecordId[] } | undefined;
  // a plain press on an element already selected: a click (no drag) selects it alone
  let narrow: RecordId | undefined;
  return {
    id: SELECT_TOOL,
    title: 'Select',
    shortcut: 'v',
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerMove: (ctx, e) => {
          ctx.session.hover.set(ctx.hitTest(e.page));
          return undefined;
        },
        onPointerDown: (ctx, e) => {
          if (e.button !== 0) return undefined;
          const hit = ctx.hitTest(e.page);
          const before = ctx.session.selection.get();
          // a press on a selected element keeps the selection, for a drag (M6.14); a click narrows it on release
          const kept = hit !== undefined && !e.shift && before.includes(hit);
          if (!kept) ctx.session.selection.set(clickSelection(before, hit, e.shift));
          narrow = kept ? hit : undefined;
          press = hit === undefined ? { screen: e.screen, page: e.page, shift: e.shift, before } : undefined;
          return { to: 'pointing' };
        },
        onKeyDown: (ctx, e) => {
          if (!(e.mod && e.key.toLowerCase() === 'a')) return undefined;
          ctx.session.selection.set(ctx.allElements());
          return { to: 'idle' };
        },
      },
      pointing: {
        id: 'pointing',
        onPointerMove: (_ctx, e) =>
          // tzap disable next-line EqualityOperator: a move of exactly DRAG_PX
          press !== undefined && Math.hypot(e.screen.x - press.screen.x, e.screen.y - press.screen.y) >= DRAG_PX ? { to: 'brushing', info: e } : undefined,
        onPointerUp: (ctx) => {
          if (narrow !== undefined) ctx.session.selection.set([narrow]);
          return { to: 'idle' };
        },
        onCancel: () => ({ to: 'idle' }),
      },
      brushing: {
        id: 'brushing',
        onEnter: (ctx, info) => brush(ctx, info as { page: Vec2 }),
        onPointerMove: (ctx, e) => {
          brush(ctx, e);
          return undefined;
        },
        onPointerUp: () => ({ to: 'idle' }),
        onExit: (ctx) => ctx.session.marquee.set(undefined),
        // Esc puts the selection back as it was before the press
        onCancel: (ctx) => {
          if (press !== undefined) ctx.session.selection.set(press.before);
          return { to: 'idle' };
        },
      },
    },
  };

  /** The marquee from the press to `e`, and what it selects (added to the old selection with shift). */
  function brush(ctx: Parameters<NonNullable<Tool['states'][string]['onEnter']>>[0], e: { readonly page: Vec2 }): void {
    if (press === undefined) return;
    const { box, mode } = marquee(press.page, e.page);
    ctx.session.marquee.set(box);
    const picked = ctx.elementsIn(box, mode);
    ctx.session.selection.set(press.shift ? union(press.before, picked) : picked);
  }
}

/**
 * The hand tool: a drag with any button moves the page with the pointer.
 *
 * @public
 */
export function handTool(): Tool {
  let last = { x: 0, y: 0 };
  return {
    id: 'hand',
    title: 'Hand',
    shortcut: 'h',
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerDown: (_ctx, e) => {
          last = e.screen;
          return { to: 'panning' };
        },
      },
      panning: {
        id: 'panning',
        onPointerMove: (ctx, e) => {
          ctx.session.camera.set(panBy(ctx.session.camera.get(), { x: e.screen.x - last.x, y: e.screen.y - last.y }));
          last = e.screen;
          return undefined;
        },
        onPointerUp: () => ({ to: 'idle' }),
        onCancel: () => ({ to: 'idle' }),
      },
    },
  };
}

/**
 * Register the built-in tools into `registry` (source `editor`).
 *
 * @public
 */
export function registerBuiltinTools(registry: Registry<string, Tool>): void {
  for (const tool of [selectTool(), handTool()]) registry.register(tool.id, tool, 'editor');
}
