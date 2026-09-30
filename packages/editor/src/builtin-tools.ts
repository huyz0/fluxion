// The built-in tools (FR-EDT-003): `select` (select-tool.ts), `hand`, which pans with any button, and
// the creation tools shape, text, frame and image (create-tool.ts), connector (connector-tool.ts), and
// pen and freehand (path-tool.ts).
import type { Registry } from '@fluxion/core';
import { panBy } from './camera.js';
import { connectorTool } from './connector-tool.js';
import { frameTool, imageTool, shapeTool, textTool } from './create-tool.js';
import { freehandTool, penTool } from './path-tool.js';
import { selectTool } from './select-tool.js';
import type { Tool } from './tools.js';

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
  for (const tool of [selectTool(), handTool(), shapeTool(), textTool(), frameTool(), imageTool(), connectorTool(), penTool(), freehandTool()])
    registry.register(tool.id, tool, 'editor');
}
