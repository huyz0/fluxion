// The write tools (FR-MCP-001, ADR-0038): they change the open documents of the store or write a file inside the allowed roots.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { layoutDocument, patchText, validateDocument } from '@fluxion/cli/ops';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { failure, type Reply, success } from './reply.js';
import { type Source, type Sources, sourceSchema } from './source.js';
import type { DocResult, OpenDoc } from './store.js';

const baseRevision = z.number().int().positive().optional().describe('The revision the change is based on; refused when the document has moved on.');

/** The error reply of a refused store change. */
const refused = (r: Extract<DocResult, { ok: false }>): Reply => failure([{ code: r.error.code, severity: 'error', message: r.error.message }]);

/** The error reply when `base` is given and is not the document's current revision. */
function staleReply(doc: OpenDoc, base: number | undefined): Reply | undefined {
  if (base === undefined || base === doc.revision) return undefined;
  return failure([
    {
      code: 'FLX_MCP_STALE_REVISION',
      severity: 'error',
      message: `${doc.handle} is at revision ${doc.revision}, not ${base}; read it again and rebase the change`,
    },
  ]);
}

function registerCreate(server: McpServer, sources: Sources): void {
  server.registerTool(
    'create_document',
    {
      description: 'Open a document from FluxScript text or a file and return its docHandle and revision. Every other tool names the document by that handle.',
      inputSchema: { fluxscript: sourceSchema.fluxscript, path: sourceSchema.path },
    },
    async (input: Source) => {
      const s = await sources.resolve(input, true);
      if (!s.ok) return s.reply;
      const doc = sources.documentText(s, input);
      if (!doc.ok) return failure(doc.diagnostics);
      const valid = validateDocument(doc.value.text);
      if (!valid.ok) return failure([...doc.diagnostics, ...valid.diagnostics]);
      const { doc: opened, evicted } = sources.store.create(doc.value.text, input.path);
      return success(`opened ${opened.handle}`, {}, [...doc.diagnostics, ...valid.diagnostics], {
        docHandle: opened.handle,
        revision: opened.revision,
        ...(evicted === undefined ? {} : { evicted }),
      });
    },
  );
}

function registerPatch(server: McpServer, sources: Sources): void {
  server.registerTool(
    'apply_patch',
    {
      description: 'Apply an AI patch (JSON) to an open document, all or nothing; returns the new revision.',
      inputSchema: {
        docHandle: z.string().describe('A handle from create_document.'),
        patch: z.union([z.string(), z.record(z.string(), z.unknown())]).describe('The patch, as an object or as JSON text.'),
        baseRevision,
      },
    },
    ({ docHandle, patch, baseRevision: base }) => {
      const found = sources.store.get(docHandle);
      if (!found.ok) return refused(found);
      const old = staleReply(found.doc, base);
      if (old) return old;
      const r = patchText(found.doc.text, typeof patch === 'string' ? patch : JSON.stringify(patch), sources.registries);
      if (!r.ok) return failure(r.diagnostics);
      const stored = sources.store.replace(docHandle, r.value.text, base);
      if (!stored.ok) return refused(stored);
      return success(`${r.value.applied.ops} ops applied`, { ...r.value.applied }, r.diagnostics, { docHandle, revision: stored.doc.revision });
    },
  );
}

/** Runs the layout over the document `input` names; with `store`, keeps the result as the next revision of the open document. */
async function arrange(sources: Sources, input: Source, algorithm: string | undefined, store?: { readonly base: number | undefined }): Promise<Reply> {
  const s = await sources.resolve(input);
  if (!s.ok) return s.reply;
  const doc = sources.documentText(s, input);
  if (!doc.ok) return failure(doc.diagnostics);
  const r = layoutDocument(doc.value.text, sources.registries, algorithm);
  if (!r.ok) return failure([...doc.diagnostics, ...r.diagnostics]);
  const stored = store && input.docHandle !== undefined ? sources.store.replace(input.docHandle, r.value.text, store.base) : undefined;
  if (stored && !stored.ok) return refused(stored);
  const extra = stored ? { ...s.extra, revision: stored.doc.revision } : s.extra;
  return success(`${r.value.screens} screens arranged`, { screens: r.value.screens, scores: r.value.scores }, [...doc.diagnostics, ...r.diagnostics], extra);
}

function registerLayout(server: McpServer, sources: Sources): void {
  server.registerTool(
    'layout',
    {
      description:
        'Arrange the elements of every screen with a layout algorithm and report the scorecard. With apply and a docHandle the open document is changed.',
      inputSchema: {
        ...sourceSchema,
        algorithm: z.string().optional().describe('layered (default), grid, ...'),
        apply: z.boolean().optional().describe('Store the arrangement in the open document (docHandle only).'),
        baseRevision,
      },
    },
    async ({ algorithm, apply, baseRevision: base, ...input }) => {
      if (apply !== true) return arrange(sources, input, algorithm);
      if (input.docHandle === undefined) return failure([{ code: 'FLX_CLI_USAGE', severity: 'error', message: 'apply needs a docHandle' }]);
      const found = sources.store.get(input.docHandle);
      if (!found.ok) return refused(found);
      return staleReply(found.doc, base) ?? arrange(sources, input, algorithm, { base });
    },
  );
}

function registerSave(server: McpServer, sources: Sources): void {
  server.registerTool(
    'save_file',
    {
      description: 'Write an open document to a .flux.json file inside the allowed roots. Nothing is written for a path outside them.',
      inputSchema: { docHandle: z.string().describe('A handle from create_document.'), path: z.string().describe('The file to write.'), baseRevision },
    },
    async ({ docHandle, path, baseRevision: base }) => {
      const found = sources.store.get(docHandle);
      if (!found.ok) return refused(found);
      const old = staleReply(found.doc, base);
      if (old) return old;
      const real = sources.roots.resolve(path);
      if (real === undefined) return failure([{ code: 'FLX_MCP_PATH_OUTSIDE_ROOTS', severity: 'error', message: `${path} is outside the allowed roots` }]);
      try {
        await mkdir(dirname(real), { recursive: true });
        await writeFile(real, found.doc.text, 'utf8');
      } catch {
        return failure([{ code: 'FLX_CLI_IO', severity: 'error', message: `cannot write ${path}` }]);
      }
      return success(`saved ${path}`, { bytes: Buffer.byteLength(found.doc.text, 'utf8') }, [], { docHandle, revision: found.doc.revision });
    },
  );
}

/**
 * Registers `create_document`, `apply_patch`, `layout` and `save_file` on `server`.
 *
 * @internal
 */
export function registerWriteTools(server: McpServer, sources: Sources): void {
  registerCreate(server, sources);
  registerPatch(server, sources);
  registerLayout(server, sources);
  registerSave(server, sources);
}
