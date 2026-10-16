// The MCP server (FR-MCP-001, ADR-0038): tools over the operation layer of @fluxion/cli, documents named by handles.

import { catalogText, hostRegistries } from '@fluxion/cli/ops';
import type { CatalogFormat } from '@fluxion/dsl';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * What a server is started with.
 *
 * @public
 */
export interface ServerOptions {
  /** Folders a path argument may point into (ADR-0038); default: the working directory only. */
  readonly roots?: readonly string[];
}

const FORMATS = ['llm', 'json', 'md'] as const satisfies readonly CatalogFormat[];

/**
 * A server holding no documents yet. Tools are registered here; a transport is connected by the caller.
 *
 * @public
 */
export function createServer(_options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'fluxion', version: '0.0.0' });
  const host = hostRegistries();
  server.registerTool(
    'list_catalog',
    {
      description: 'List the shapes, layouts and markers this host can draw, in the format an AI reads best.',
      inputSchema: { format: z.enum(FORMATS).optional() },
    },
    ({ format }) => {
      const r = catalogText(host.registries, format ?? 'llm');
      if (!r.ok) return { isError: true, content: [{ type: 'text', text: r.diagnostics.map((d) => d.message).join('; ') }] };
      return { content: [{ type: 'text', text: r.value.text }], structuredContent: { format: format ?? 'llm', text: r.value.text } };
    },
  );
  return server;
}
