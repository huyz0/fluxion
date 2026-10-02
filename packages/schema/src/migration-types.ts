// The shapes a migration works on (02-document-model §4): kept apart from the chain so a step can name them without
// a cycle through it.

/**
 * A document before validation: a schema version, a record map, anything else kept.
 *
 * @public
 */
export type RawDocument = {
  /** `MAJOR.MINOR` schema version. */
  readonly schemaVersion: string;
  /** Records keyed by id, unvalidated. */
  readonly records: { readonly [id: string]: unknown };
  /** Other top-level data, kept. */
  readonly [key: string]: unknown;
};

/**
 * One migration step from schema version `from` to `to`. `up` is pure: it returns a new
 * document and never mutates its input.
 *
 * @public
 */
export type Migration = {
  /** Version it applies to. */
  readonly from: string;
  /** Version it produces. */
  readonly to: string;
  /** The conversion. */
  readonly up: (doc: RawDocument) => RawDocument;
};
