import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

/** The built bin; the ladder and CI build before testing (`pnpm run build`). */
const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

describe('the stdio server (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: the fluxion-mcp bin starts and lists its tools to a spawned client', { timeout: 30_000 }, async () => {
    if (!existsSync(BIN)) throw new Error(`${BIN} is missing: run pnpm run build first`);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], stderr: 'pipe' }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('list_catalog');
    } finally {
      await client.close();
    }
  });
});
