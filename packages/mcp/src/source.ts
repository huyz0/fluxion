// Naming a document (ADR-0038): by handle, FluxScript text or a path inside the roots; exactly one.
import { readFile } from 'node:fs/promises';
import { compileDocument, type hostRegistries, type OpResult } from '@fluxion/cli/ops';
import { z } from 'zod';
import { failure, type Reply, usage } from './reply.js';
import type { Roots } from './roots.js';
import type { DocStore } from './store.js';

type Registries = ReturnType<typeof hostRegistries>['registries'];

/** The input schema of a tool that reads a document. */
export const sourceSchema: {
  docHandle: z.ZodOptional<z.ZodString>;
  fluxscript: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
} = {
  docHandle: z.string().optional().describe('A handle from create_document.'),
  fluxscript: z.string().optional().describe('FluxScript text, compiled first.'),
  path: z.string().optional().describe('A file inside the allowed roots.'),
};

/** The input of a tool that reads a document. */
export type Source = { docHandle?: string | undefined; fluxscript?: string | undefined; path?: string | undefined };

/** What a source resolved to: its text, and the handle and revision when it was a handle; or the error reply. */
export type Resolved = { ok: true; text: string; extra: Record<string, unknown> } | { ok: false; reply: Reply };

const error = (code: string, message: string): Resolved => ({ ok: false, reply: failure([{ code, severity: 'error', message }]) });

/** Resolves sources against a store and the roots, and turns FluxScript into document text. */
export class Sources {
  readonly store: DocStore;
  readonly roots: Roots;
  readonly registries: Registries;

  constructor(store: DocStore, roots: Roots, registries: Registries) {
    this.store = store;
    this.roots = roots;
    this.registries = registries;
  }

  /** The text a source names. With `textOnly`, a handle is refused (the tool takes FluxScript, not a document). */
  async resolve(input: Source, textOnly = false): Promise<Resolved> {
    const given = [input.docHandle, input.fluxscript, input.path].filter((v) => v !== undefined);
    if (given.length !== 1) return { ok: false, reply: failure([usage('give exactly one of docHandle, fluxscript or path')]) };
    if (input.docHandle !== undefined)
      return textOnly ? error('FLX_CLI_USAGE', 'this tool takes fluxscript or path, not docHandle') : this.#handle(input.docHandle);
    if (input.path !== undefined) return this.#file(input.path);
    return { ok: true, text: input.fluxscript as string, extra: {} };
  }

  #handle(handle: string): Resolved {
    const r = this.store.get(handle);
    if (!r.ok) return error(r.error.code, r.error.message);
    return { ok: true, text: r.doc.text, extra: { docHandle: r.doc.handle, revision: r.doc.revision } };
  }

  async #file(path: string): Promise<Resolved> {
    const real = this.roots.resolve(path);
    if (real === undefined) return error('FLX_MCP_PATH_OUTSIDE_ROOTS', `${path} is outside the allowed roots`);
    try {
      return { ok: true, text: await readFile(real, 'utf8'), extra: {} };
    } catch {
      return error('FLX_CLI_IO', `cannot read ${path}`);
    }
  }

  /** Document text for a resolved source: FluxScript (given as text or as a .yaml path) is compiled, anything else is already a document. */
  documentText(r: Extract<Resolved, { ok: true }>, input: Source): OpResult<{ text: string }> {
    const isScript = input.fluxscript !== undefined || (input.path !== undefined && /\.ya?ml$/.test(input.path));
    if (!isScript) return { ok: true, value: { text: r.text }, diagnostics: [] };
    const c = compileDocument(r.text, this.registries);
    return c.ok ? { ok: true, value: { text: c.value.text }, diagnostics: c.diagnostics } : c;
  }
}
