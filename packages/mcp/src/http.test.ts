import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type HttpHandle, serveHttp } from './http.js';

let running: HttpHandle | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } },
});

/** POSTs the initialize request with the given headers; the status. */
function post(handle: HttpHandle, headers: Record<string, string>): Promise<number> {
  return new Promise((ok, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: handle.port,
        path: '/mcp',
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => ok(res.statusCode ?? 0));
      },
    );
    req.on('error', fail);
    req.end(INITIALIZE);
  });
}

describe('the streamable HTTP transport (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: the server listens on 127.0.0.1 and a client lists the tools over HTTP', async () => {
    running = await serveHttp({ roots: [process.cwd()] });
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(running.url)) as unknown as Transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('render_screen_png');
    await client.close();
  });

  it('FR-MCP-001: a foreign Origin is refused with 403, a loopback Origin is served', async () => {
    running = await serveHttp();
    expect(await post(running, { origin: 'https://evil.example' })).toBe(403);
    expect(await post(running, { origin: 'null' })).toBe(403);
    expect(await post(running, { origin: `http://localhost:${running.port}` })).toBe(200);
    expect(await post(running, {})).toBe(200);
  });

  it('FR-MCP-001: a Host header that is not this loopback server is refused with 403 (DNS rebinding)', async () => {
    running = await serveHttp();
    expect(await post(running, { host: 'evil.example' })).toBe(403);
    expect(await post(running, { host: `evil.example:${running.port}` })).toBe(403);
    expect(await post(running, { host: `localhost:${running.port}` })).toBe(200);
  });

  it('FR-MCP-001: only POST /mcp is served', async () => {
    running = await serveHttp();
    const get = await fetch(running.url);
    expect(get.status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${running.port}/other`, { method: 'POST' })).status).toBe(404);
  });
});
