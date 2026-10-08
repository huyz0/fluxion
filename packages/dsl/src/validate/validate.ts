// Validate stage (ADR-0030 "Pipeline stages in R2", 06-ai-authoring.md §3 stage 6): the compiled records go through `@fluxion/schema`'s
// `validate` (structural, then referential), and each schema diagnostic is pointed at the source of the record it names. Its `path` stays
// the schema's document pointer (`/records/<id>/...`): that is where the value is, and a FluxScript pointer cannot be derived for every
// field; `source` is the FluxScript place. In lenient mode an error at a field the schema refuses is auto-fixed by removing that field
// (the value, else an enclosing object key up to the record's top-level field), when the removal leaves no error the document did not
// already have; the fixed error is then a warning that says what was removed.
import { type AnyRecord, type Diagnostic, type DocumentFile, jsonPointer, type RecordId, SCHEMA_VERSION, validate } from '@fluxion/schema';
import type { DslDiagnostic, SourceRange } from '../types.js';

/**
 * What the validate stage runs on: the placed records and where each came from.
 *
 * @public
 */
export type ValidateInput = {
  /** The records, keyed by id. */
  readonly records: { readonly [id: string]: AnyRecord };
  /** Where each record came from, by id. */
  readonly sourceMap: ReadonlyMap<RecordId, SourceRange>;
};

/**
 * How to validate.
 *
 * @public
 */
export type ValidateOptions = {
  /** `strict` (default) reports every schema problem as the schema rates it; `lenient` removes a refused field and reports a warning. */
  readonly mode?: 'strict' | 'lenient';
  /** Where a problem that names no record with a source points (the whole file). */
  readonly fallback?: SourceRange;
};

/**
 * What {@link validateFlux} gives back.
 *
 * @public
 */
export type ValidateResult = {
  /** The document (in lenient mode, with the auto-fixes applied). */
  readonly doc: DocumentFile;
  /** The schema's problems with their source ranges, in source order. */
  readonly diagnostics: readonly DslDiagnostic[];
};

type Obj = { [key: string]: unknown };
type Fix = { readonly doc: DocumentFile; readonly found: readonly Diagnostic[]; readonly removed: string };

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sameProblem = (a: Diagnostic, b: Diagnostic) => a.code === b.code && a.path === b.path && a.message === b.message;
const isError = (d: Diagnostic) => d.severity === 'error';

/** The segments of a JSON pointer (RFC 6901). */
function segments(pointer: string): string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** `doc` without the object key at `path` (`records`, id, then field segments); undefined when the path names no object key. */
function without(doc: DocumentFile, path: readonly string[]): DocumentFile | undefined {
  const copy = JSON.parse(JSON.stringify(doc)) as Obj;
  let at: unknown = copy;
  for (const s of path.slice(0, -1)) at = isObj(at) ? at[s] : undefined;
  const last = path[path.length - 1] as string;
  if (!(isObj(at) && Object.hasOwn(at, last))) return undefined;
  delete at[last];
  return copy as DocumentFile;
}

/** The removal that clears `error` without bringing in an error `before` lacks: the value first, then each enclosing key to the field. */
function fixFor(doc: DocumentFile, before: readonly Diagnostic[], error: Diagnostic): Fix | undefined {
  const path = segments(error.path);
  if (path[0] !== 'records' || path.length < 3) return undefined;
  for (let n = path.length; n >= 3; n--) {
    const candidate = without(doc, path.slice(0, n));
    if (!candidate) continue;
    const found = validate(candidate);
    const errors = found.filter(isError);
    if (errors.some((d) => sameProblem(d, error))) continue;
    if (errors.every((d) => before.some((b) => sameProblem(b, d)))) return { doc: candidate, found, removed: jsonPointer(path.slice(0, n)) };
  }
  return undefined;
}

/** An error by what it says, to remember one no removal fixes. */
const problemKey = (d: Diagnostic): string => `${d.code}\u0000${d.path}\u0000${d.message}`;

/**
 * Lenient fixes, one error at a time until none can be fixed; each fix removes at least one error, so this ends. An error no removal
 * fixed is not tried again after a later fix, so the validations grow with the errors, not with their product (M12.14 review F1).
 */
function fixAll(doc: DocumentFile, found: readonly Diagnostic[]): { doc: DocumentFile; found: readonly Diagnostic[]; fixed: Map<Diagnostic, string> } {
  const fixed = new Map<Diagnostic, string>();
  const unfixable = new Set<string>();
  let state = { doc, found };
  for (let progress = true; progress; ) {
    progress = false;
    for (const error of state.found.filter(isError)) {
      if (unfixable.has(problemKey(error))) continue;
      const fix = fixFor(state.doc, state.found, error);
      if (!fix) {
        unfixable.add(problemKey(error));
        continue;
      }
      fixed.set(error, fix.removed);
      state = fix;
      progress = true;
      break;
    }
  }
  return { ...state, fixed };
}

/** The record a schema pointer names: its second segment under `/records`. */
function recordOf(path: string): RecordId | undefined {
  const s = segments(path);
  return s[0] === 'records' && s[1] !== undefined ? (s[1] as RecordId) : undefined;
}

/**
 * Validate compiled records against the schema (`schemaVersion` is `@fluxion/schema`'s `SCHEMA_VERSION`) and point each problem at the
 * source of its record, else at `options.fallback`.
 *
 * @public
 */
export function validateFlux(input: ValidateInput, options: ValidateOptions = {}): ValidateResult {
  const doc: DocumentFile = { schemaVersion: SCHEMA_VERSION, records: input.records };
  const first = validate(doc);
  const result = options.mode === 'lenient' ? fixAll(doc, first) : { doc, found: first, fixed: new Map<Diagnostic, string>() };
  const sourceOf = (d: Diagnostic): SourceRange | undefined => {
    const id = recordOf(d.path);
    return (id !== undefined ? input.sourceMap.get(id) : undefined) ?? options.fallback;
  };
  const shown = [...[...result.fixed].map(([d, removed]) => ({ d, removed })), ...result.found.map((d) => ({ d, removed: undefined }))];
  const diagnostics = shown.map(({ d, removed }) => {
    const source = sourceOf(d);
    const fixedAs = removed === undefined ? {} : { severity: 'warning' as const, message: `${d.message} (lenient: removed ${removed})` };
    return { ...d, ...fixedAs, ...(source ? { source } : {}) } as DslDiagnostic;
  });
  // the schema lists problems by record id, a hash: in source order they read top to bottom (a stable sort keeps the schema's order on ties)
  const at = (d: DslDiagnostic) => d.source?.offset ?? Number.MAX_SAFE_INTEGER;
  return { doc: result.doc, diagnostics: diagnostics.sort((a, b) => at(a) - at(b)) };
}
