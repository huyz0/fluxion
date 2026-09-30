// The built-in tools (FR-EDT-003): `select` picks the topmost element under a click (the marquee,
// shift, moving and resizing arrive with M6.13-M6.15) and tracks the hovered one; `hand` pans the
// canvas with any button.
import type { Registry } from '@fluxion/core';
import { panBy } from './camera.js';
import { SELECT_TOOL, type Tool } from './tools.js';

/**
 * The select tool.
 *
 * @public
 */
export function selectTool(): Tool {
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
          ctx.session.selection.set(hit === undefined ? [] : [hit]);
          return { to: 'pointing' };
        },
      },
      pointing: {
        id: 'pointing',
        onPointerUp: () => ({ to: 'idle' }),
        onCancel: () => ({ to: 'idle' }),
      },
    },
  };
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
