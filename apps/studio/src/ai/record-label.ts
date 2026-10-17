// A short name for a record in the AI panel (the change list and the scope given to the model): its words, its semantic label or slug, else its kind.

/** The parts of a record a name is taken from. */
export type Named = {
  readonly type: string;
  readonly kind?: string;
  readonly name?: string;
  readonly text?: unknown;
  readonly semantic?: { readonly label?: string; readonly slug?: string };
};

/** The text nodes of a rich-text document, joined. */
function plainOf(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === 'string') return n.text;
  return Array.isArray(n.content) ? n.content.map(plainOf).join(' ') : '';
}

/** What to call `record`. */
export function labelOf(record: Named): string {
  const words = plainOf(record.text).trim();
  return words || record.semantic?.label || record.semantic?.slug || record.name || record.kind || record.type;
}
