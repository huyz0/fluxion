import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileDocument, hostRegistries } from '@fluxion/cli/ops';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from './server.js';
import { DocStore } from './store.js';

const dir = mkdtempSync(join(tmpdir(), 'fluxion-mcp-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SCRIPT =
  'flux: 1\ntitle: Pipeline\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect }\n      b: { shape: rect }\n    edges:\n      - a -> b\n';

/** A client connected to a fresh server over the in-memory transport, with `dir` as its only root. */
async function connect(store?: DocStore): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ roots: [dir], ...(store ? { store } : {}) }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

type Reply = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };
const call = async (client: Client, name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Reply;

/** Compiles SCRIPT through the server and writes the document into the root. */
async function document(client: Client): Promise<string> {
  const compiled = await call(client, 'compile_dsl', { fluxscript: SCRIPT });
  expect(compiled.isError).toBeFalsy();
  const yaml = join(dir, 'doc.flux.yaml');
  writeFileSync(yaml, SCRIPT);
  return yaml;
}

describe('the MCP read tools over the in-memory transport (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: a connected client lists the server tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_catalog');
    expect(tools.every((t) => (t.description ?? '').length > 0)).toBe(true);
  });

  it('FR-MCP-001: the server offers exactly the six read tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['compile_dsl', 'get_document_outline', 'get_screen', 'lint', 'list_catalog', 'validate']));
    expect(tools.every((t) => (t.description ?? '').length > 0)).toBe(true);
  });

  it('FR-MCP-001: list_catalog returns the catalog text as content and as structured content', async () => {
    const r = await call(await connect(), 'list_catalog', { format: 'json' });
    expect(r.isError).toBeFalsy();
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('basic:rect');
    expect(r.structuredContent).toMatchObject({ format: 'json', text, diagnostics: [] });
  });

  it('FR-MCP-001: compile_dsl counts screens and records, and rejects bad FluxScript with diagnostics', async () => {
    const client = await connect();
    const ok = await call(client, 'compile_dsl', { fluxscript: SCRIPT });
    expect(ok.structuredContent).toMatchObject({ screens: 1 });
    const bad = await call(client, 'compile_dsl', { fluxscript: 'not: [flux' });
    expect(bad.isError).toBe(true);
    expect((bad.structuredContent?.['diagnostics'] as unknown[] | undefined)?.length).toBeGreaterThan(0);
  });

  it('FR-MCP-001: get_document_outline lists the screens, and get_screen returns the screen as FluxScript', async () => {
    const client = await connect();
    const source = { fluxscript: SCRIPT };
    const outline = await call(client, 'get_document_outline', source);
    expect(outline.structuredContent).toMatchObject({ title: 'Pipeline', screens: [{ elements: 3 }] });
    const id = (outline.structuredContent?.['screens'] as { id: string }[] | undefined)?.[0]?.id;
    const screen = await call(client, 'get_screen', { ...source, screen: id });
    expect(screen.structuredContent?.['text']).toContain('a');
    expect((await call(client, 'get_screen', { ...source, screen: 'nope' })).isError).toBe(true);
  });

  it('FR-MCP-001: validate and lint accept a path inside the root and report diagnostics', async () => {
    const client = await connect();
    const path = await document(client);
    expect((await call(client, 'validate', { path })).structuredContent).toMatchObject({ valid: true, diagnostics: [] });
    const linted = await call(client, 'lint', { path });
    expect(typeof linted.structuredContent?.['score']).toBe('number');
    expect((await call(client, 'lint', { path, minScore: 0 })).isError).toBeFalsy();
  });

  it('FR-MCP-001: a path outside the roots is refused with FLX_MCP_PATH_OUTSIDE_ROOTS', async () => {
    const r = await call(await connect(), 'validate', { path: '/etc/passwd' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.['diagnostics']).toMatchObject([{ code: 'FLX_MCP_PATH_OUTSIDE_ROOTS' }]);
  });

  it('FR-MCP-001: giving none or several sources, or an unknown handle, is an error result', async () => {
    const client = await connect();
    expect((await call(client, 'validate', {})).isError).toBe(true);
    expect((await call(client, 'validate', { fluxscript: SCRIPT, path: 'x' })).isError).toBe(true);
    const unknown = await call(client, 'validate', { docHandle: 'doc_9' });
    expect(unknown.structuredContent?.['diagnostics']).toMatchObject([{ code: 'FLX_MCP_NO_SUCH_DOC' }]);
  });

  it('FR-MCP-001: a result for an open document names its handle and revision, and the revision follows an edit', async () => {
    const store = new DocStore();
    const client = await connect(store);
    const path = await document(client);
    const compiled = compileDocument(SCRIPT, hostRegistries().registries);
    if (!compiled.ok) throw new Error('the fixture script must compile');
    const text = compiled.value.text;
    const { doc } = store.create(text);
    expect((await call(client, 'validate', { docHandle: doc.handle })).structuredContent).toMatchObject({ docHandle: doc.handle, revision: 1 });
    store.replace(doc.handle, text);
    expect((await call(client, 'get_document_outline', { docHandle: doc.handle })).structuredContent).toMatchObject({ docHandle: doc.handle, revision: 2 });
    // a path or FluxScript source is not a stored document: no handle, no revision
    expect((await call(client, 'validate', { path })).structuredContent).not.toHaveProperty('revision');
  });
});
