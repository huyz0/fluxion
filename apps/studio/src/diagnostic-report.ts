// The diagnostic report (NFR-OBS-002): what a person can paste into a bug report. Versions, how big the document is and what went wrong, and nothing the document
// says: no text, name, label, title, URL, asset name or id. Only counts and names the schema and the studio themselves define go in (anything else is counted as `other`), so a sentinel written anywhere in a
// document cannot reach the report (the test writes one into every free-text field).
import type { LogEntry } from '@fluxion/core';
import { ELEMENT_KINDS, RECORD_TYPES } from '@fluxion/schema';

/** What the report is made from. */
export type ReportInput = {
  /** Versions by name (the studio, the schema, the file format). */
  readonly versions: { readonly [name: string]: string };
  /** The document's records. Only each record's `type` and, for an element, its `kind` are read. */
  readonly records: { readonly [id: string]: unknown };
  /** Log entries the studio collected (warnings and errors). Only the level and the namespace are read. */
  readonly entries: readonly LogEntry[];
  /** The browser's user agent string. */
  readonly userAgent?: string;
};

type Typed = { readonly type?: unknown; readonly kind?: unknown };

/** The record types and element kinds the schema defines, and the areas of the studio that log: the only names that reach the report. */
const TYPES: ReadonlySet<string> = new Set(RECORD_TYPES);
const KINDS: ReadonlySet<string> = new Set(ELEMENT_KINDS);
const AREAS: ReadonlySet<string> = new Set(['studio', 'core', 'render', 'layout', 'routing', 'editor', 'player', 'format']);

/** `value` when it is one of `allowed`, else `other`: a document's own strings (a plugin's kind, an unknown type, an id) are never a key of the report. */
const named = (allowed: ReadonlySet<string>, value: unknown): string => (typeof value === 'string' && allowed.has(value) ? value : 'other');

/** How many of each value `pick` gives over `items`. */
function tally<T>(items: readonly T[], pick: (item: T) => string): { readonly [key: string]: number } {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The report, as the JSON text to copy. */
export function diagnosticReport(input: ReportInput): string {
  const records = Object.values(input.records).map((r) => (typeof r === 'object' && r !== null ? (r as Typed) : {}));
  const elements = records.filter((r) => r.type === 'element');
  const report = {
    versions: input.versions,
    userAgent: input.userAgent ?? '',
    document: {
      records: records.length,
      byType: tally(records, (r) => named(TYPES, r.type)),
      elementsByKind: tally(elements, (r) => named(KINDS, r.kind)),
    },
    problems: {
      byLevel: tally(input.entries, (e) => e.level),
      byNamespace: tally(input.entries, (e) => (e.namespace === '' ? 'root' : named(AREAS, e.namespace.split(':')[0]))),
    },
  };
  return JSON.stringify(report, null, 2);
}
