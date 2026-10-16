// The document's problems (FR-EDT-021, M7.26): what `validate()` reports about the records, and what a few lint
// rules notice about how they are laid out, each with the fix the panel offers when there is one. Pure: the Problems
// tab (problems-tab.tsx) shows the list and runs the fixes through the editor's `execute`.
import { createRegistry } from '@fluxion/core';
import { CORE_LINT_RULES, type LintFinding, lint, registerLintRules } from '@fluxion/dsl';
import { DEFAULT_SCREEN_SIZE, type Diagnostic, type DocumentFile, type RecordId, validate } from '@fluxion/schema';
import { themeOf } from '@fluxion/theme';

/**
 * A fix: a document command with its arguments.
 *
 * @public
 */
export type ProblemFix = {
  /** What the button says. */
  readonly title: string;
  /** The document command to run. */
  readonly command: string;
  /** Its arguments. */
  readonly args: unknown;
};

/**
 * One problem of the document.
 *
 * @public
 */
export type Problem = {
  /** Stable while the problem stands: its code and the records it is about. */
  readonly id: string;
  /** How serious it is. */
  readonly severity: 'error' | 'warning' | 'info';
  /** One line for people. */
  readonly message: string;
  /** The elements it is about (the panel selects them). */
  readonly elements: readonly RecordId[];
  /** How to fix it, when a command can. */
  readonly fix?: ProblemFix;
};

type Rec = { readonly id: string; readonly type: string; readonly [field: string]: unknown };
type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** How far the fix of a stack moves the element on top, in page px (the clipboard's paste offset, ADR-0020). */
const STACK_OFFSET = 16;

/** The record `id` of `doc`. */
const recordOf = (doc: DocumentFile, id: string): Rec | undefined => doc.records[id] as Rec | undefined;

/** The centre of the screen `id` (the page point a freed end is held at), or the origin. */
function centreOf(doc: DocumentFile, id: unknown): { x: number; y: number } {
  const size = (recordOf(doc, String(id))?.['size'] as { w?: number; h?: number } | undefined) ?? DEFAULT_SCREEN_SIZE;
  return { x: (size.w ?? DEFAULT_SCREEN_SIZE.w) / 2, y: (size.h ?? DEFAULT_SCREEN_SIZE.h) / 2 };
}

/** The fix that lets go of the `end` of connector `connectorId`, holding it at the middle of its screen. */
function freeEndFix(doc: DocumentFile, connectorId: string, end: string): ProblemFix | undefined {
  const connector = recordOf(doc, connectorId);
  if (connector?.['kind'] !== 'connector' || (end !== 'source' && end !== 'target')) return undefined;
  return { title: 'Free the end', command: 'connector.freeEnd', args: { connectorId, end, at: centreOf(doc, connector['screenId']) } };
}

/** The `[record id, field]` a diagnostic's JSON pointer `/records/<id>/<field>…` names. */
function pointed(path: string): readonly [string, string] | undefined {
  const [, root, id, field] = path.split('/');
  return root === 'records' && id !== undefined ? [id.replace(/~1/g, '/').replace(/~0/g, '~'), field ?? ''] : undefined;
}

/** The problem a diagnostic of `validate()` makes, with its fix where one is known. */
function fromDiagnostic(doc: DocumentFile, d: Diagnostic): Problem {
  const at = pointed(d.path);
  const record = at === undefined ? undefined : recordOf(doc, at[0]);
  const base = {
    id: `${d.code}${d.path}`,
    severity: d.severity,
    message: d.message,
    elements: at === undefined || record?.type !== 'element' ? [] : [at[0] as RecordId],
  };
  // a connector end that is neither bound nor free: hold it somewhere
  const missing = d.code === 'FLX_CONNECTOR_END_MISSING' ? /^the (source|target) end/.exec(d.message)?.[1] : undefined;
  // a binding to an element that is not there: let go of the end it held
  const dangling = d.code === 'FLX_REF_MISSING' && record?.type === 'binding' && at?.[1] === 'elementId';
  const end = missing ?? (dangling ? String(record?.['end']) : undefined);
  const connector = missing === undefined ? String(record?.['connectorId']) : (at?.[0] as string);
  const fix = end === undefined ? undefined : freeEndFix(doc, connector, end);
  return fix === undefined ? base : { ...base, fix };
}

/** Stacked elements: those of one screen and parent with the same box. */
function stacked(doc: DocumentFile): readonly Problem[] {
  const groups = new Map<string, Rec[]>();
  for (const r of Object.values(doc.records) as Rec[]) {
    const t = r['transform'] as Box | undefined;
    if (r.type !== 'element' || r['kind'] === 'connector' || t === undefined) continue;
    const key = `${String(r['screenId'])}|${String(r['parentId'] ?? '')}|${t.x}|${t.y}|${t.w}|${t.h}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g): Problem => {
      const sorted = [...g].sort((a, b) => (String(a['index']) < String(b['index']) ? -1 : 1));
      const top = sorted.at(-1) as Rec;
      const t = top['transform'] as Box;
      return {
        id: `stacked|${sorted.map((r) => r.id).join('|')}`,
        severity: 'warning',
        message: `${g.length} elements lie exactly on top of one another`,
        elements: sorted.map((r) => r.id as RecordId),
        fix: {
          title: 'Offset the top one',
          command: 'element.update',
          args: { id: top.id, fields: { transform: { ...t, x: t.x + STACK_OFFSET, y: t.y + STACK_OFFSET } } },
        },
      };
    });
}

const CORE_RULES = createRegistry<string, unknown>('lintRules');
registerLintRules(CORE_RULES);
const SEVERITY: { readonly [id: string]: Problem['severity'] } = Object.fromEntries(CORE_LINT_RULES.map((r) => [r.code, r.severity]));

/** The fix for an element that sticks out of its screen: move it back inside (the size is kept, or shrunk to the screen). */
function inside(doc: DocumentFile, id: string): ProblemFix | undefined {
  const e = recordOf(doc, id);
  const t = e?.['transform'] as (Box & { rot?: number }) | undefined;
  const size = (recordOf(doc, String(e?.['screenId']))?.['size'] as { w?: number; h?: number } | undefined) ?? DEFAULT_SCREEN_SIZE;
  if (e === undefined || t === undefined || size.w === undefined || size.h === undefined) return undefined;
  const [w, h] = [Math.min(t.w, size.w), Math.min(t.h, size.h)];
  const moved = { ...t, w, h, x: Math.min(Math.max(t.x, 0), size.w - w), y: Math.min(Math.max(t.y, 0), size.h - h) };
  return { title: 'Move inside the screen', command: 'element.update', args: { id, fields: { transform: moved } } };
}

/** The problem a lint finding makes, with the fix its rule offers where there is one. */
function fromFinding(doc: DocumentFile, f: LintFinding): Problem {
  const fix = f.code === 'FLX_LINT_OFFSCREEN' ? inside(doc, f.elements[0] ?? '') : undefined;
  const base: Problem = { id: `${f.code}|${f.elements.join('|')}`, severity: SEVERITY[f.code] ?? f.severity, message: f.message, elements: f.elements };
  return fix === undefined ? base : { ...base, fix };
}

/** The document's theme record read as a theme, for the contrast rule. */
function themeOfDocument(doc: DocumentFile) {
  const record = (Object.values(doc.records) as Rec[]).find((r) => r.type === 'theme');
  return record === undefined ? undefined : themeOf(record);
}

/**
 * The problems of `doc`: its validation diagnostics, then the lint findings, in a stable order.
 *
 * @public
 */
export function problemsOf(doc: DocumentFile): readonly Problem[] {
  const stack = stacked(doc);
  const theme = themeOfDocument(doc);
  // elements exactly on top of one another are reported once, by `stacked`, with its fix
  const covered = new Set(stack.map((p) => [...p.elements].sort().join('|')));
  const found = lint(doc, CORE_RULES, theme === undefined ? {} : { theme }).findings.filter(
    (f) => !(f.code === 'FLX_LINT_OVERLAP' && covered.has([...f.elements].sort().join('|'))),
  );
  return [...validate(doc).map((d) => fromDiagnostic(doc, d)), ...stack, ...found.map((f) => fromFinding(doc, f))];
}
