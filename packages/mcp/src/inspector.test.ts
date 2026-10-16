import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEAT_SHEET } from '@fluxion/dsl';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples.js';
import { RESOURCE_URIS } from './resources.js';
import { createServer } from './server.js';

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ roots: [process.cwd()] }).connect(serverSide);
  const client = new Client({ name: 'inspector', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

const readText = async (client: Client, uri: string): Promise<string> => {
  const r = await client.readResource({ uri });
  const [first] = r.contents;
  return first && 'text' in first ? first.text : '';
};

describe('the MCP server as an inspector sees it (FR-MCP-001, FR-MCP-002, ADR-0038)', () => {
  it('FR-MCP-001: lists exactly 11 tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'apply_patch',
      'compile_dsl',
      'create_document',
      'get_document_outline',
      'get_screen',
      'layout',
      'lint',
      'list_catalog',
      'render_screen_png',
      'save_file',
      'validate',
    ]);
  });

  it('FR-MCP-002: lists 6 resource URIs (five fixed and the examples template)', async () => {
    const client = await connect();
    const fixed = (await client.listResources()).resources.map((r) => r.uri);
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
    expect([...fixed.filter((u) => !u.includes('/examples/')), ...templates].sort()).toEqual(Object.values(RESOURCE_URIS).sort());
    expect(Object.values(RESOURCE_URIS)).toHaveLength(6);
    expect(fixed.filter((u) => u.includes('/examples/')).length).toBe(Object.keys(EXAMPLES).length);
  });

  it('FR-MCP-002: lists 3 prompts, and each returns one user message naming the loop tools', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['animate_screen', 'diagram_from_description', 'generate_deck']);
    const deck = await client.getPrompt({ name: 'generate_deck', arguments: { topic: 'Q3 plan', screens: '4' } });
    expect(deck.messages).toHaveLength(1);
    const body = JSON.stringify(deck.messages[0]);
    for (const word of ['Q3 plan', '4 screens', RESOURCE_URIS.guide, 'list_catalog', 'validate', 'render_screen_png']) expect(body).toContain(word);
    const anim = await client.getPrompt({ name: 'animate_screen', arguments: { docHandle: 'doc_1' } });
    expect(JSON.stringify(anim.messages)).toContain('doc_1');
  });

  it('FR-MCP-002: the authoring guide resource is the cheat sheet the llms.txt is built from', async () => {
    expect(await readText(await connect(), RESOURCE_URIS.guide)).toBe(CHEAT_SHEET);
  });

  it('FR-MCP-002: the schemas are JSON, the diagnostics guide lists FLX_DSL codes, the catalog lists basic:rect', async () => {
    const client = await connect();
    expect(JSON.parse(await readText(client, RESOURCE_URIS.fluxscriptSchema))).toBeTypeOf('object');
    expect(JSON.parse(await readText(client, RESOURCE_URIS.patchSchema))).toBeTypeOf('object');
    expect(await readText(client, RESOURCE_URIS.diagnostics)).toContain('FLX_DSL_');
    expect(await readText(client, RESOURCE_URIS.catalog)).toContain('basic:rect');
  });

  it('FR-MCP-002: an example resource is the file under examples/dsl, and every bundled example matches its file', async () => {
    const client = await connect();
    expect(await readText(client, 'fluxion://examples/layered-flow')).toBe(EXAMPLES['layered-flow']);
    const dir = join(__dirname, '../../../examples/dsl');
    for (const [name, text] of Object.entries(EXAMPLES)) expect(text).toBe(readFileSync(join(dir, `${name}.flux.yaml`), 'utf8'));
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(Object.keys(EXAMPLES).length);
  });

  it('FR-MCP-002: an unknown example, even an inherited property name, is an error', async () => {
    const client = await connect();
    await expect(client.readResource({ uri: 'fluxion://examples/constructor' })).rejects.toThrow(/no example/);
  });
});
