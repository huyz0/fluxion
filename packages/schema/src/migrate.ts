// Schema migrations (02-document-model §4, FR-DOC-003, contracts.md rule 9): an ordered chain of
// pure `{ from, to, up }` steps over the raw record map, run until the document reaches
// SCHEMA_VERSION. Every released version keeps a fixture that must migrate and validate.
import { SCHEMA_VERSION } from './document-file.js';
import type { FluxError } from './errors.js';
import { err, ok, type Result } from './result.js';

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

/**
 * The released migration chain. Empty while 1.0 is the only released version; the next schema
 * change appends a step here with a fixture of the version it leaves (contracts.md rule 8).
 *
 * @public
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Result of {@link migrate}: the document at the current version and the steps applied.
 *
 * @public
 */
export type Migrated = {
  /** The migrated document. */
  readonly document: RawDocument;
  /** `from→to` of each applied step, in order. */
  readonly applied: readonly string[];
};

const VERSION = /^(\d+)\.(\d+)$/;
const parts = (v: string): [number, number] | null => {
  const m = VERSION.exec(v);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const isPlainObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
// records must be a plain object: null or an array is left to validate() (FLX_RECORDS_INVALID), never migrated or repaired (M2.12 review)
const isRaw = (v: unknown): v is RawDocument => isPlainObject(v) && typeof v['schemaVersion'] === 'string' && isPlainObject(v['records']);

/**
 * Bring a document to {@link SCHEMA_VERSION} by running the migration chain from its version.
 * A document already at (or at a newer minor of) the current major is returned unchanged, so
 * migrating twice equals migrating once.
 *
 * @param migrations - the chain to use (tests pass a synthetic one)
 * @returns `MIGRATION_UNSUPPORTED` when the version is malformed, of a newer major, or has no path
 * @public
 */
export function migrate(doc: unknown, migrations: readonly Migration[] = MIGRATIONS): Result<Migrated, FluxError> {
  if (!isRaw(doc)) return unsupported('not a document: schemaVersion and records are required');
  let current: RawDocument = doc;
  const applied: string[] = [];
  // a chain is walked at most once per step: a looping chain is an error, not a hang
  for (let steps = 0; steps <= migrations.length; steps++) {
    const next = stepFrom(current, migrations);
    if (next === 'done') return ok({ document: current, applied });
    if (!next.ok) return next;
    applied.push(`${current.schemaVersion}→${next.value.schemaVersion}`);
    current = next.value;
  }
  return unsupported(`the migration chain loops (${applied.join(', ')})`);
}

const unsupported = <T>(message: string, path?: string): Result<T, FluxError> =>
  err({ code: 'MIGRATION_UNSUPPORTED', message, ...(path === undefined ? {} : { path }) });

/** One migration step from `doc`'s version, or `done` when it is current (or a newer minor). */
function stepFrom(doc: RawDocument, migrations: readonly Migration[]): 'done' | Result<RawDocument, FluxError> {
  const v = parts(doc.schemaVersion);
  const target = parts(SCHEMA_VERSION) ?? [0, 0];
  if (v === null) return unsupported(`schemaVersion ${JSON.stringify(doc.schemaVersion)} is not MAJOR.MINOR`, '/schemaVersion');
  if (v[0] > target[0]) return unsupported(`schema ${doc.schemaVersion} is newer than ${SCHEMA_VERSION}`, '/schemaVersion');
  if (v[0] === target[0] && v[1] >= target[1]) return 'done';
  const step = migrations.find((m) => m.from === doc.schemaVersion);
  if (step === undefined) return unsupported(`no migration from schema ${doc.schemaVersion}`, '/schemaVersion');
  const next = step.up(doc);
  return next.schemaVersion === step.to ? ok(next) : unsupported(`migration ${step.from}→${step.to} produced ${next.schemaVersion}`);
}
