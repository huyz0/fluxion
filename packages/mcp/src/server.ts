// The MCP server (FR-MCP-001, ADR-0038): tools over the operation layer of @fluxion/cli, documents named by handles.

import type { Launcher } from '@fluxion/cli';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { Roots } from './roots.js';
import { DocStore } from './store.js';
import { registerReadTools } from './tools.js';

/**
 * What a server is started with.
 *
 * @public
 */
export interface ServerOptions {
  /** Folders a path argument may point into (ADR-0038); default: the working directory only. */
  readonly roots?: readonly string[];
  /** The documents the server starts with; default: an empty store. A result names `docHandle` and `revision` only for a document of the store. */
  readonly store?: DocStore;
  /** Starts the headless browser `render_screen_png` uses; default: Playwright's Chromium. A test passes a fake. */
  readonly launch?: Launcher;
}

/**
 * A server holding no documents yet. Tools are registered here; a transport is connected by the caller.
 *
 * @public
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'fluxion', version: '0.0.0' });
  registerReadTools(server, options.store ?? new DocStore(), new Roots(options.roots ?? [process.cwd()]), options.launch);
  registerResources(server);
  registerPrompts(server);
  return server;
}
