// The read tools (FR-MCP-001, ADR-0038): each runs an operation of @fluxion/cli/ops over a document named by handle, text or path.
import { catalogText, compileDocument, hostRegistries, lintDocument, type OpResult, outlineDocument, screenText, validateDocument } from '@fluxion/cli/ops';
import type { CatalogFormat } from '@fluxion/dsl';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { failure, type Reply, success } from './reply.js';
import type { Roots } from './roots.js';
import { type Source, Sources, sourceSchema } from './source.js';
import type { DocStore } from './store.js';

const FORMATS = ['llm', 'json', 'md'] as const satisfies readonly CatalogFormat[];

/** Runs `op` over the document `input` names and shapes the reply. */
async function run(
  sources: Sources,
  input: Source,
  op: (text: string) => OpResult<Record<string, unknown>>,
  summarize: (value: Record<string, unknown>) => string,
): Promise<Reply> {
  const s = await sources.resolve(input);
  if (!s.ok) return s.reply;
  const doc = sources.documentText(s, input);
  if (!doc.ok) return failure(doc.diagnostics);
  const r = op(doc.value.text);
  const diagnostics = [...doc.diagnostics, ...r.diagnostics];
  return r.ok ? success(summarize(r.value), r.value, diagnostics, s.extra) : failure(diagnostics);
}

function registerDocumentTools(server: McpServer, sources: Sources): void {
  const { registries } = sources;
  server.registerTool(
    'get_document_outline',
    { description: 'The title and screens of a document with their ids, names and element counts. Read this before get_screen.', inputSchema: sourceSchema },
    (input) =>
      run(
        sources,
        input,
        (text) => outlineDocument(text),
        (v) => `${(v['screens'] as unknown[]).length} screens`,
      ),
  );
  server.registerTool(
    'get_screen',
    {
      description: 'One screen of a document as FluxScript, the format to edit in. The first screen when screen is omitted.',
      inputSchema: { ...sourceSchema, screen: z.string().optional().describe('A screen id from get_document_outline.') },
    },
    ({ screen, ...input }) =>
      run(
        sources,
        input,
        (text) => screenText(text, registries, screen),
        (v) => `screen ${String(v['screen'])}`,
      ),
  );
}

function registerCheckTools(server: McpServer, sources: Sources): void {
  const { registries } = sources;
  server.registerTool(
    'validate',
    { description: 'Check a document against the schema; reports every diagnostic and changes nothing.', inputSchema: sourceSchema },
    (input) =>
      run(
        sources,
        input,
        (text) => {
          const r = validateDocument(text);
          return r.ok ? { ok: true, value: { valid: true }, diagnostics: r.diagnostics } : r;
        },
        () => 'valid',
      ),
  );
  server.registerTool(
    'lint',
    {
      description: 'Score a document 0-100 for layout, readability and accessibility problems and list each finding.',
      inputSchema: { ...sourceSchema, minScore: z.number().min(0).max(100).optional().describe('Fail when the score is lower.') },
    },
    ({ minScore, ...input }) =>
      run(
        sources,
        input,
        (text) => lintDocument(text, registries, minScore === undefined ? {} : { minScore }),
        (v) => `score ${String(v['score'])}, ${(v['findings'] as unknown[]).length} findings`,
      ),
  );
}

function registerCompileTools(server: McpServer, sources: Sources): void {
  const { registries } = sources;
  server.registerTool(
    'list_catalog',
    {
      description: 'List the shapes, layouts and markers this host can draw, in the format an AI reads best.',
      inputSchema: { format: z.enum(FORMATS).optional() },
    },
    ({ format }) => {
      const r = catalogText(registries, format ?? 'llm');
      if (!r.ok) return failure(r.diagnostics);
      const used = format ?? 'llm';
      return { content: [{ type: 'text' as const, text: r.value.text }], structuredContent: { format: used, text: r.value.text, diagnostics: r.diagnostics } };
    },
  );
  server.registerTool(
    'compile_dsl',
    {
      description: 'Compile FluxScript to a document without keeping it; reports the counts and every diagnostic.',
      inputSchema: { fluxscript: sourceSchema.fluxscript, path: sourceSchema.path },
    },
    async (input) => {
      const s = await sources.resolve(input, true);
      if (!s.ok) return s.reply;
      const r = compileDocument(s.text, registries);
      if (!r.ok) return failure(r.diagnostics);
      return success(`${r.value.screens} screens, ${r.value.records} records`, { screens: r.value.screens, records: r.value.records }, r.diagnostics);
    },
  );
}

/**
 * Registers `get_document_outline`, `get_screen`, `validate`, `lint`, `list_catalog` and `compile_dsl` on `server`.
 *
 * @internal
 */
export function registerReadTools(server: McpServer, store: DocStore, roots: Roots): void {
  const sources = new Sources(store, roots, hostRegistries().registries);
  registerDocumentTools(server, sources);
  registerCheckTools(server, sources);
  registerCompileTools(server, sources);
}
