// The stdio transport (ADR-0038): protocol frames on stdout, logs on stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, type ServerOptions } from './server.js';

/**
 * Serves MCP over this process's stdin and stdout until the client closes the connection.
 *
 * @public
 */
export async function serveStdio(options: ServerOptions = {}): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
}
