// Prompts (FR-MCP-002, ADR-0038): three starting points that tell a model which tools and resources to use, in what order.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RESOURCE_URIS } from './resources.js';

const message = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

const READ_FIRST = `Read ${RESOURCE_URIS.guide} and call list_catalog before writing; use only shapes the catalog lists.`;
const LOOP =
  'Open it with create_document, then check it with validate and lint (aim for a score of 85 or more), fix every finding with apply_patch, and look at the result with render_screen_png.';

/**
 * Registers `generate_deck`, `diagram_from_description` and `animate_screen` on `server`.
 *
 * @internal
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'generate_deck',
    {
      description: 'Write a multi-screen deck on a topic as FluxScript.',
      argsSchema: { topic: z.string().describe('What the deck is about.'), screens: z.string().optional().describe('How many screens, e.g. 5.') },
    },
    ({ topic, screens }) =>
      message(
        `Write a deck about: ${topic}${screens ? ` (${screens} screens)` : ''}. ${READ_FIRST} Start from an outline, then write one FluxScript screen per outline item, each with a title, alt text for its shapes and a reading order that follows the story. ${LOOP}`,
      ),
  );
  server.registerPrompt(
    'diagram_from_description',
    {
      description: 'Turn a written description into one diagram screen.',
      argsSchema: {
        description: z.string().describe('What the diagram shows.'),
        kind: z.string().optional().describe('flowchart, architecture, sequence, ...'),
      },
    },
    ({ description, kind }) =>
      message(
        `Draw ${kind ? `a ${kind}` : 'a diagram'} of: ${description}. ${READ_FIRST} State nodes and edges and let the layout place them; pin a node only when the description fixes its place. ${LOOP}`,
      ),
  );
  server.registerPrompt(
    'animate_screen',
    {
      description: 'Add build steps and transitions to a screen of an open document.',
      argsSchema: {
        docHandle: z.string().describe('A handle from create_document.'),
        screen: z.string().optional().describe('A screen id from get_document_outline.'),
      },
    },
    ({ docHandle, screen }) =>
      message(
        `Animate ${screen ? `screen ${screen}` : 'the first screen'} of ${docHandle}. Call get_screen to read it, then add build steps that reveal the elements in reading order with apply_patch (see ${RESOURCE_URIS.patchSchema}); keep each step to one idea. Validate after each patch and look at the result with render_screen_png.`,
      ),
  );
}
