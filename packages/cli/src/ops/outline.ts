// The `outline` and `screen` operations: what an agent reads before it edits (FR-MCP-001, ADR-0038).
import { decompileScreen } from '@fluxion/dsl';
import { compareKeys, type Diagnostic, type DocumentRecord, parseDocument, type RecordId, type ScreenRecord } from '@fluxion/schema';
import type { CoreRegistries } from '@fluxion/sdk';
import { type OpResult, opFail, opOk } from './result.js';

/**
 * One screen in an outline.
 *
 * @public
 */
export type OutlineScreen = {
  /** The screen's record id. */
  readonly id: string;
  /** Its display name, empty when it has none. */
  readonly name: string;
  /** How many elements it holds. */
  readonly elements: number;
};

/**
 * The shape of a document: its title and its screens in order, never raw records.
 *
 * @public
 */
export type Outline = {
  /** The document title, empty when it has none. */
  readonly title: string;
  /** The screens, in order. */
  readonly screens: readonly OutlineScreen[];
};

const notFound = (screen: string): Diagnostic => ({
  code: 'FLX_CLI_USAGE',
  severity: 'error',
  path: '',
  message: `the document has no screen "${screen}"`,
  hint: 'Take a screen id from get_document_outline.',
});

/**
 * The title and screens of the document in `text`.
 *
 * @public
 */
export function outlineDocument(text: string): OpResult<Outline> {
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  const records = Object.values(parsed.value.document.records);
  const counts = new Map<string, number>();
  for (const r of records) if ('screenId' in r) counts.set(String(r.screenId), (counts.get(String(r.screenId)) ?? 0) + 1);
  const screens = records
    .filter((r): r is ScreenRecord => r.type === 'screen')
    .sort((a, b) => compareKeys(a.index, b.index))
    .map((s) => ({ id: s.id, name: s.name ?? '', elements: counts.get(s.id) ?? 0 }));
  const doc = records.find((r): r is DocumentRecord => r.type === 'document');
  return opOk({ title: doc?.title ?? '', screens }, parsed.value.diagnostics);
}

/**
 * One screen of the document in `text` as FluxScript; the first screen when `screenId` is omitted.
 *
 * @public
 */
export function screenText(
  text: string,
  registries: CoreRegistries,
  screenId?: string,
): OpResult<{ readonly screen: string; readonly text: string; readonly kept: number }> {
  const outline = outlineDocument(text);
  if (!outline.ok) return outline;
  const wanted = screenId ?? outline.value.screens[0]?.id;
  if (wanted === undefined || !outline.value.screens.some((s) => s.id === wanted)) return opFail([notFound(wanted ?? '(none)')]);
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  const r = decompileScreen(parsed.value.document, wanted as RecordId, { registries });
  return opOk({ screen: wanted, text: r.text, kept: r.kept }, outline.diagnostics);
}
