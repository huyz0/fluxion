// `render_screen_png` (FR-MCP-001, ADR-0038): one screen of a document as an MCP image, so a model can look at what it made.
import { type Launcher, renderScreenPng } from '@fluxion/cli';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { failure } from './reply.js';
import { type Sources, sourceSchema } from './source.js';

/**
 * Registers `render_screen_png` on `server`; `launch` starts the headless browser (default: Playwright's Chromium).
 *
 * @internal
 */
export function registerRenderTool(server: McpServer, sources: Sources, launch?: Launcher): void {
  server.registerTool(
    'render_screen_png',
    {
      description:
        'Draw one screen of a document as a PNG image (the first screen by default, at most 2048 px wide). Needs a headless Chromium; without one the result says how to install it.',
      inputSchema: {
        ...sourceSchema,
        screen: z.string().optional().describe('A screen id from get_document_outline.'),
        width: z.number().int().min(1).max(2048).optional().describe('Largest width in pixels; 1280 by default.'),
      },
    },
    async ({ screen, width, ...input }) => {
      const s = await sources.resolve(input);
      if (!s.ok) return s.reply;
      const doc = sources.documentText(s, input);
      if (!doc.ok) return failure(doc.diagnostics);
      const r = await renderScreenPng(doc.value.text, {
        ...(screen === undefined ? {} : { screen }),
        ...(width === undefined ? {} : { width }),
        ...(launch === undefined ? {} : { launch }),
      });
      if (!r.ok) return failure([...doc.diagnostics, ...r.diagnostics]);
      const { png, width: w, height: h, screen: id } = r.value;
      return {
        content: [
          { type: 'image' as const, mimeType: 'image/png', data: Buffer.from(png).toString('base64') },
          { type: 'text' as const, text: `screen ${id}, ${w}x${h} px` },
        ],
        structuredContent: { screen: id, width: w, height: h, diagnostics: [...doc.diagnostics, ...r.diagnostics], ...s.extra },
      };
    },
  );
}
