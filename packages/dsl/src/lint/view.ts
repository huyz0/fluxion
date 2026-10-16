// What the rules read of a document: its screens and, per screen, the boxed elements with their text (records are untyped JSON here).
import { DEFAULT_SCREEN_SIZE, type DocumentFile, type RecordId, type RichTextNode } from '@fluxion/schema';

/** A record of a document, read loosely. */
export type Rec = { readonly id: string; readonly type: string; readonly [field: string]: unknown };

/** An axis-aligned box. */
export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** A boxed element of a screen. */
export type Boxed = { readonly id: RecordId; readonly rec: Rec; readonly box: Box; readonly text: string };

/** A screen with its boxed elements; `size` is undefined for an infinite canvas (nothing is off it). */
export type ScreenView = { readonly id: RecordId; readonly size: { readonly w: number; readonly h: number } | undefined; readonly elements: readonly Boxed[] };

const isBox = (v: unknown): v is Box => {
  const b = v as Box | undefined;
  return typeof b === 'object' && b !== null && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n));
};

/** The plain text of a rich-text value: its text nodes, blocks joined by a space. */
export function plainText(node: unknown): string {
  const n = node as RichTextNode | undefined;
  if (typeof n !== 'object' || n === null) return '';
  const own = typeof n['text'] === 'string' ? n['text'] : '';
  const children = Array.isArray(n['content']) ? (n['content'] as unknown[]).map(plainText).join(' ') : '';
  return `${own}${children}`.replace(/\s+/g, ' ').trim();
}

/** Every record of `doc` of the type, in id order. */
export const recordsOf = (doc: DocumentFile, type: string): readonly Rec[] =>
  (Object.values(doc.records) as Rec[]).filter((r) => r.type === type).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The screens of `doc` with their visible boxed elements (connectors have no box and hidden elements are not seen). */
export function screensOf(doc: DocumentFile): readonly ScreenView[] {
  const elements = recordsOf(doc, 'element').filter((e) => e['hidden'] !== true && isBox(e['transform']));
  return recordsOf(doc, 'screen').map((s) => {
    const size = s['kind'] === 'infinite' ? undefined : { ...DEFAULT_SCREEN_SIZE, ...((s['size'] as object | undefined) ?? {}) };
    const own = elements
      .filter((e) => e['screenId'] === s.id)
      .map((rec) => ({ id: rec.id as RecordId, rec, box: rec['transform'] as Box, text: plainText(rec['text']) }));
    return { id: s.id as RecordId, size, elements: own };
  });
}
