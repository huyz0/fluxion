import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

/** A client connected to a fresh server over the in-memory transport. */
async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('the MCP server over the in-memory transport (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: a connected client lists the server tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_catalog');
    expect(tools.every((t) => (t.description ?? '').length > 0)).toBe(true);
  });

  it('FR-MCP-001: list_catalog returns the catalog text as content and as structured content', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'list_catalog', arguments: { format: 'json' } });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('basic:rect');
    expect(r.structuredContent).toMatchObject({ format: 'json', text });
  });
});
