// The documents the studio opens by id until files arrive (M10): `new` is a new empty document, and
// `example-<name>` is a bundled example (examples/<name>.flux.json), parsed like any file.
import { newDocument } from '@fluxion/editor';
import { type DocumentFile, err, ok, parseDocument, type Random, type Result } from '@fluxion/schema';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (the studio is built and tested through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

/** The bundled examples by name, as text. */
const EXAMPLES: ReadonlyMap<string, string> = new Map(
  Object.entries(import.meta.glob('../../../examples/*.flux.json', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [
    (path.split('/').at(-1) ?? path).replace(/\.flux\.json$/, ''),
    text,
  ]),
);

/**
 * The names of the bundled examples.
 *
 * @public
 */
export function exampleNames(): readonly string[] {
  return [...EXAMPLES.keys()].sort();
}

/**
 * The document `docId` names: a new one (ids from `random`), a bundled example, or why there is none.
 *
 * @public
 */
export function loadDocument(docId: string, random: Random): Result<DocumentFile, string> {
  if (docId === 'new') return ok(newDocument(random));
  const name = docId.startsWith('example-') ? docId.slice('example-'.length) : undefined;
  const text = name === undefined ? undefined : EXAMPLES.get(name);
  if (text === undefined) return err(`There is no document "${docId}" here yet: opening files arrives with M10.`);
  const parsed = parseDocument(text);
  return parsed.ok ? ok(parsed.value.document) : err(`The example "${name}" does not load: ${parsed.error.diagnostics.map((d) => d.message).join('; ')}`);
}
