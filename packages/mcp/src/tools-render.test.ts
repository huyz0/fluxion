import type { Browser, Launcher } from '@fluxion/cli';
import { compileDocument, hostRegistries } from '@fluxion/cli/ops';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';
import { DocStore } from './store.js';

const SCRIPT = 'flux: 1\ntitle: Pic\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect }\n';

/** A document of one screen of `w` x `h`: SCRIPT compiled, then its screen record resized. */
function sized(w: number, h: number): string {
  const c = compileDocument(SCRIPT, hostRegistries().registries);
  if (!c.ok) throw new Error('the fixture script must compile');
  const doc = JSON.parse(c.value.text) as { records: Record<string, { type: string; size?: unknown }> };
  for (const r of Object.values(doc.records)) if (r.type === 'screen') r.size = { w, h };
  return JSON.stringify(doc);
}

/** The first 24 bytes of a PNG: signature, IHDR length and type, then width and height. */
function header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A browser that "photographs" a 4000 x 2000 screen at the scale it is asked for. */
const fake: Launcher = async (): Promise<Browser> => ({
  newPage: async ({ deviceScaleFactor }) => ({
    setContent: async () => undefined,
    locator: () => ({ screenshot: async () => header(Math.round(4000 * deviceScaleFactor), Math.round(2000 * deviceScaleFactor)) }),
  }),
  close: async () => undefined,
});

/** A client of a server holding one document of 4000 x 2000; the handle is returned too. */
async function connect(launch: Launcher): Promise<Client & { handle: string }> {
  const store = new DocStore();
  const handle = store.create(sized(4000, 2000)).doc.handle;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ launch, store }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return Object.assign(client, { handle });
}

type Reply = { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[]; structuredContent?: Record<string, unknown> };
const call = async (client: Client & { handle: string }, args: Record<string, unknown>) =>
  (await client.callTool({ name: 'render_screen_png', arguments: { docHandle: client.handle, ...args } })) as Reply;

describe('render_screen_png (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: the result is image/png content plus a size line, scaled down to the default width of 1280', async () => {
    const r = await call(await connect(fake), {});
    expect(r.isError).toBeFalsy();
    const image = r.content.find((c) => c.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    const bytes = Buffer.from(image?.data ?? '', 'base64');
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(r.structuredContent).toMatchObject({ width: 1280, height: 640 });
    expect(r.content.find((c) => c.type === 'text')?.text).toContain('1280x640');
  });

  it('FR-MCP-001: width is honoured up to 2048 and refused above it', async () => {
    const client = await connect(fake);
    expect((await call(client, { width: 2048 })).structuredContent).toMatchObject({ width: 2048 });
    await expect(call(client, { width: 4096 })).resolves.toMatchObject({ isError: true });
  });

  it('FR-MCP-001: without a browser the result is FLX_CLI_PEER_MISSING with the install hint', async () => {
    const none: Launcher = async () => {
      throw new Error("Executable doesn't exist");
    };
    const r = await call(await connect(none), {});
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.['diagnostics']).toMatchObject([{ code: 'FLX_CLI_PEER_MISSING' }]);
  });

  it('FR-MCP-001: an unknown screen is an error result', async () => {
    const r = await call(await connect(fake), { screen: 'nope' });
    expect(r.isError).toBe(true);
  });
});
