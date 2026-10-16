// The streamable HTTP transport (ADR-0038): bound to 127.0.0.1 only, with Host and Origin checks against DNS rebinding and
// cross-site requests. Stateless: every POST gets its own protocol server over the one shared document store.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer, type ServerOptions } from './server.js';
import { DocStore } from './store.js';

/** Largest request body accepted, in bytes. */
const MAX_BODY = 4 * 1024 * 1024;
const LOCAL_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A running HTTP server.
 *
 * @public
 */
export interface HttpHandle {
  /** The address to give a client, `http://127.0.0.1:<port>/mcp`. */
  readonly url: string;
  /** The port it listens on. */
  readonly port: number;
  /** Stops listening and drops open connections. */
  readonly close: () => Promise<void>;
}

/**
 * What the HTTP server is started with.
 *
 * @public
 */
export interface HttpOptions extends ServerOptions {
  /** Port to listen on; 0 (default) takes a free one. */
  readonly port?: number;
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/** Whether the Host header names this server on a loopback name. */
function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const i = host.lastIndexOf(':');
  return i > 0 && host.slice(i + 1) === String(port) && LOCAL_NAMES.has(host.slice(0, i));
}

/** Whether a request carries no Origin, or one that is a loopback page. */
function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return LOCAL_NAMES.has(new URL(origin).hostname === '::1' ? '[::1]' : new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new RangeError('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handle(req: IncomingMessage, res: ServerResponse, port: number, options: ServerOptions): Promise<void> {
  if (!hostAllowed(req.headers.host, port)) return reject(res, 403, 'forbidden host');
  if (!originAllowed(req.headers.origin)) return reject(res, 403, 'forbidden origin');
  if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') return reject(res, 404, 'not found');
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return reject(res, 405, 'method not allowed');
  }
  let body: unknown;
  try {
    body = await readBody(req);
  } catch (e) {
    return reject(res, e instanceof RangeError ? 413 : 400, e instanceof RangeError ? 'request body too large' : 'body is not JSON');
  }
  const transport = new StreamableHTTPServerTransport({
    // `undefined` is the SDK's stateless mode; its declaration omits `undefined` under exactOptionalPropertyTypes
    sessionIdGenerator: undefined as unknown as () => string,
    enableJsonResponse: true,
  });
  const server = createServer(options);
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(req, res, body);
}

/**
 * Serves MCP over streamable HTTP on 127.0.0.1 until `close()`. The documents are shared by every request.
 *
 * @public
 */
export async function serveHttp(options: HttpOptions = {}): Promise<HttpHandle> {
  const shared: ServerOptions = { ...options, store: options.store ?? new DocStore() };
  let port = 0;
  const server: Server = createHttpServer((req, res) => {
    handle(req, res, port, shared).catch(() => {
      if (!res.headersSent) reject(res, 500, 'internal error');
      else res.end();
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 0, '127.0.0.1', ok);
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
