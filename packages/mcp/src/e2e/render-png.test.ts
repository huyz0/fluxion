import { compileDocument, hostRegistries } from '@fluxion/cli/ops';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../server.js';
import { DocStore } from '../store.js';

const SCRIPT = 'flux: 1\ntitle: Pic\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect, text: Hello }\n';

describe('render_screen_png with a real headless Chromium (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: a screen of 640 x 360 comes back as a PNG of exactly that size', { timeout: 60_000 }, async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const compiled = compileDocument(SCRIPT, hostRegistries().registries);
    if (!compiled.ok) throw new Error('the fixture script must compile');
    const doc = JSON.parse(compiled.value.text) as { records: Record<string, { type: string; size?: unknown }> };
    for (const r of Object.values(doc.records)) if (r.type === 'screen') r.size = { w: 640, h: 360 };
    const store = new DocStore();
    const { handle } = store.create(JSON.stringify(doc)).doc;
    await createServer({ store }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    const r = (await client.callTool({ name: 'render_screen_png', arguments: { docHandle: handle } })) as {
      content: { type: string; data?: string; mimeType?: string }[];
    };
    const image = r.content.find((c) => c.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    const png = Buffer.from(image?.data ?? '', 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 360]);
  });
});
