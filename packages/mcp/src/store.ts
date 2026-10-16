// The open documents of one server process (ADR-0038): `docHandle` -> text and revision, at most 32 at a time.

/**
 * Most documents a store keeps; creating one more evicts the least recently used.
 *
 * @public
 */
export const MAX_OPEN_DOCS = 32;
/** How many evicted handles the store remembers, so a later call can say "evicted" rather than "unknown". */
const REMEMBERED_EVICTIONS = 64;

/**
 * One open document.
 *
 * @public
 */
export interface OpenDoc {
  /** The handle the document is named by. */
  readonly handle: string;
  /** The document's text (a `.flux.json` file's contents). */
  readonly text: string;
  /** Starts at 1 and rises by one for every replacement of the text. */
  readonly revision: number;
  /** The file it was opened from, when it came from one. */
  readonly path?: string;
}

/**
 * A lookup that failed, with the diagnostic code of ADR-0038.
 *
 * @public
 */
export interface DocLookupError {
  /** The diagnostic code of ADR-0038. */
  readonly code: 'FLX_MCP_NO_SUCH_DOC' | 'FLX_MCP_DOC_EVICTED' | 'FLX_MCP_STALE_REVISION';
  /** What to do next, for the agent reading it. */
  readonly message: string;
}

/**
 * What a lookup or replacement returns: the document, or why there is none.
 *
 * @public
 */
export type DocResult =
  | {
      /** The document was found. */
      readonly ok: true;
      /** The document, as it now stands. */
      readonly doc: OpenDoc;
    }
  | {
      /** The document was not found or the change was refused. */
      readonly ok: false;
      /** Why. */
      readonly error: DocLookupError;
    };

/**
 * What `create` returns.
 *
 * @public
 */
export interface Created {
  /** The new document. */
  readonly doc: OpenDoc;
  /** The handle evicted to make room, when one was. */
  readonly evicted?: string;
}

/**
 * The documents a server holds. Handles are `doc_<n>` from a per-store counter (no clock or randomness, so a transcript replays);
 * every lookup counts as use.
 *
 * @public
 */
export class DocStore {
  readonly #docs = new Map<string, OpenDoc>();
  readonly #evicted: string[] = [];
  #next = 1;

  /** Opens a document with `text`; returns it and the handle it evicted to make room, if any. */
  create(text: string, path?: string): Created {
    let evicted: string | undefined;
    if (this.#docs.size >= MAX_OPEN_DOCS) {
      evicted = this.#docs.keys().next().value as string;
      this.#docs.delete(evicted);
      this.#evicted.push(evicted);
      if (this.#evicted.length > REMEMBERED_EVICTIONS) this.#evicted.shift();
    }
    const doc: OpenDoc = { handle: `doc_${this.#next++}`, text, revision: 1, ...(path === undefined ? {} : { path }) };
    this.#docs.set(doc.handle, doc);
    return { doc, ...(evicted === undefined ? {} : { evicted }) };
  }

  /** The document named by `handle`, marked as used, or why there is none. */
  get(handle: string): DocResult {
    const doc = this.#docs.get(handle);
    if (doc === undefined) {
      return this.#evicted.includes(handle)
        ? {
            ok: false,
            error: { code: 'FLX_MCP_DOC_EVICTED', message: `${handle} was dropped to stay within ${MAX_OPEN_DOCS} open documents; create it again` },
          }
        : { ok: false, error: { code: 'FLX_MCP_NO_SUCH_DOC', message: `no open document ${handle}; create one with create_document` } };
    }
    this.#docs.delete(handle);
    this.#docs.set(handle, doc); // most recently used goes last
    return { ok: true, doc };
  }

  /**
   * Replaces the text of `handle` and raises its revision. With `baseRevision` the replacement is refused unless that is still the
   * current revision (two writers cannot overwrite each other silently).
   */
  replace(handle: string, text: string, baseRevision?: number): DocResult {
    const found = this.get(handle);
    if (!found.ok) return found;
    if (baseRevision !== undefined && baseRevision !== found.doc.revision)
      return {
        ok: false,
        error: {
          code: 'FLX_MCP_STALE_REVISION',
          message: `${handle} is at revision ${found.doc.revision}, not ${baseRevision}; read it again and rebase the change`,
        },
      };
    const doc: OpenDoc = { ...found.doc, text, revision: found.doc.revision + 1 };
    this.#docs.set(handle, doc);
    return { ok: true, doc };
  }

  /** How many documents are open. */
  get size(): number {
    return this.#docs.size;
  }
}
