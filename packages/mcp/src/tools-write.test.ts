import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from './server.js';

const dir = mkdtempSync(join(tmpdir(), 'fluxion-mcp-write-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SCRIPT =
  'flux: 1\ntitle: Pipeline\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect }\n      b: { shape: rect }\n    edges:\n      - a -> b\n';

/** A client connected to a fresh server over the in-memory transport, with `dir` as its only root. */
async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ roots: [dir] }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

type Reply = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };
const call = async (client: Client, name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Reply;

describe('the MCP write tools over the in-memory transport (FR-MCP-001, ADR-0038)', () => {
  const PATCH = { flux: 1, ops: [{ op: 'add', screen: 'main', slug: 'c', node: { shape: 'rect', text: 'C' } }] };

  /** Opens SCRIPT and returns the client with the handle. */
  async function open(): Promise<{ client: Client; handle: string }> {
    const client = await connect();
    const r = await call(client, 'create_document', { fluxscript: SCRIPT });
    expect(r.isError).toBeFalsy();
    return { client, handle: String(r.structuredContent?.['docHandle']) };
  }

  it('FR-MCP-001: create_document returns a handle at revision 1, and rejects text that is not FluxScript', async () => {
    const { client, handle } = await open();
    expect(handle).toMatch(/^doc_\d+$/);
    expect((await call(client, 'validate', { docHandle: handle })).structuredContent).toMatchObject({ revision: 1 });
    expect((await call(client, 'create_document', { fluxscript: 'not: [flux' })).isError).toBe(true);
    expect((await call(client, 'create_document', {})).isError).toBe(true);
  });

  it('FR-MCP-001: apply_patch changes the document and raises the revision; a bad patch changes nothing', async () => {
    const { client, handle } = await open();
    const before = await call(client, 'get_document_outline', { docHandle: handle });
    const ok = await call(client, 'apply_patch', { docHandle: handle, patch: PATCH, baseRevision: 1 });
    expect(ok.isError, ok.content[0]?.text).toBeFalsy();
    expect(ok.structuredContent).toMatchObject({ revision: 2, docHandle: handle });
    const after = await call(client, 'get_document_outline', { docHandle: handle });
    expect(JSON.stringify(after.structuredContent)).not.toBe(JSON.stringify(before.structuredContent));
    const bad = await call(client, 'apply_patch', { docHandle: handle, patch: { flux: 1, ops: [{ op: 'remove', target: 'nothing-here' }] } });
    expect(bad.isError).toBe(true);
    expect((await call(client, 'validate', { docHandle: handle })).structuredContent).toMatchObject({ revision: 2 });
  });

  it('FR-MCP-001: a stale baseRevision is rejected with FLX_MCP_STALE_REVISION and the document is left as it was', async () => {
    const { client, handle } = await open();
    expect((await call(client, 'apply_patch', { docHandle: handle, patch: PATCH, baseRevision: 1 })).isError).toBeFalsy();
    const stale = await call(client, 'apply_patch', { docHandle: handle, patch: PATCH, baseRevision: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent?.['diagnostics']).toMatchObject([{ code: 'FLX_MCP_STALE_REVISION' }]);
    expect((await call(client, 'validate', { docHandle: handle })).structuredContent).toMatchObject({ revision: 2 });
  });

  it('FR-MCP-001: layout is a dry run, and with apply stores the arrangement as a new revision', async () => {
    const { client, handle } = await open();
    const dry = await call(client, 'layout', { docHandle: handle, algorithm: 'grid' });
    expect(dry.structuredContent).toMatchObject({ screens: 1, revision: 1 });
    const applied = await call(client, 'layout', { docHandle: handle, algorithm: 'grid', apply: true, baseRevision: 1 });
    expect(applied.structuredContent).toMatchObject({ revision: 2 });
    expect((await call(client, 'layout', { fluxscript: SCRIPT, apply: true })).isError).toBe(true);
  });

  it('FR-MCP-001: save_file writes inside the root, and a path outside it is an error that writes nothing', async () => {
    const { client, handle } = await open();
    const inside = join(dir, 'out', 'saved.flux.json');
    expect((await call(client, 'save_file', { docHandle: handle, path: inside })).isError).toBeFalsy();
    expect((await call(client, 'validate', { path: inside })).structuredContent).toMatchObject({ valid: true });
    const outside = join(tmpdir(), `fluxion-escape-${process.pid}.flux.json`);
    const refused = await call(client, 'save_file', { docHandle: handle, path: outside });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent?.['diagnostics']).toMatchObject([{ code: 'FLX_MCP_PATH_OUTSIDE_ROOTS' }]);
    expect(existsSync(outside)).toBe(false);
    expect((await call(client, 'save_file', { docHandle: handle, path: join(dir, 'x.json'), baseRevision: 9 })).isError).toBe(true);
    expect(existsSync(join(dir, 'x.json'))).toBe(false);
  });

  it('FR-MCP-001: a symlink inside the root that points outside it is refused', async () => {
    const { client, handle } = await open();
    const target = mkdtempSync(join(tmpdir(), 'fluxion-target-'));
    try {
      symlinkSync(target, join(dir, 'link'));
      const r = await call(client, 'save_file', { docHandle: handle, path: join(dir, 'link', 'a.flux.json') });
      expect(r.isError).toBe(true);
      expect(existsSync(join(target, 'a.flux.json'))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('FR-MCP-001: a dangling symlink inside the root that points outside it is refused and nothing is created', async () => {
    const { client, handle } = await open();
    const outside = join(tmpdir(), `fluxion-dangling-${process.pid}.flux.json`);
    symlinkSync(outside, join(dir, 'dangling.flux.json'));
    const r = await call(client, 'save_file', { docHandle: handle, path: join(dir, 'dangling.flux.json') });
    expect(r.isError).toBe(true);
    expect(existsSync(outside)).toBe(false);
  });

  it('FR-MCP-001: the server offers the ten tools of this milestone', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools).toHaveLength(10);
  });
});
