/**
 * `@fluxion/mcp` — MCP server exposing the same operations as the CLI to AI agents.
 *
 * @packageDocumentation
 */

export { type HttpHandle, type HttpOptions, serveHttp } from './http.js';
export { Roots } from './roots.js';
export { createServer, type ServerOptions } from './server.js';
export { serveStdio } from './stdio.js';
export { type Created, type DocLookupError, type DocResult, DocStore, MAX_OPEN_DOCS, type OpenDoc } from './store.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
