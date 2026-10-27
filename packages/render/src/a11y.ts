// The text a screen reader gets for what a screen draws without words (NFR-A11Y-002, ADR-0015): an image's alt text and a connector's relation, "A connects to B: label".
// Pure functions of the records, read through the store's tracked view so a rename or a rewire updates the text.
import { computed, type ReadSignal, type ReadView } from '@fluxion/core';
import type { ConnectorElement, ElementRecord, RecordId, RichTextNode } from '@fluxion/schema';

/** The characters of `node` and what it holds, blocks apart by a space. */
function textOf(node: RichTextNode): string {
  const own = node.text ?? '';
  const inner = (node.content ?? []).map(textOf).join(' ');
  return `${own}${inner}`.replace(/\s+/g, ' ').trim();
}

type Named = { readonly semantic?: { readonly label?: string }; readonly name?: string; readonly text?: RichTextNode };
type Bound = { readonly connectorId?: RecordId; readonly end?: string; readonly elementId?: RecordId };

/** What an element is called: its label, else its text, else its name, else its kind. */
export function nameOf(element: ElementRecord): string {
  const named = element as unknown as Named;
  const label = named.semantic?.label?.trim();
  if (label) return label;
  const text = named.text === undefined ? '' : textOf(named.text);
  return text || named.name?.trim() || element.kind;
}

/** Each view's element names, one shared query per element (M18.131). */
const names = new WeakMap<ReadView, Map<RecordId, ReadSignal<string | undefined>>>();

/**
 * The name of element `id` (undefined when it is not one), read through a query of its own: a connector's text then depends on the bound
 * element's name, not its whole record, so moving a shape re-reads its name once instead of redoing the text of every connector bound to it.
 */
function nameIn(view: ReadView, id: RecordId): string | undefined {
  let byId = names.get(view);
  if (byId === undefined) {
    byId = new Map();
    names.set(view, byId);
  }
  let name = byId.get(id);
  if (name === undefined) {
    const own = byId;
    name = computed(() => {
      const element = view.get(id) as ElementRecord | undefined;
      // a deleted element's query is not kept for later texts (the ones reading it still follow it)
      if (element === undefined) own.delete(id);
      return element?.type === 'element' ? nameOf(element) : undefined;
    });
    byId.set(id, name);
  }
  return name();
}

/** The name of the element bound to the `end` of `connector`, or "(unattached)". */
function endName(view: ReadView, connector: ConnectorElement, end: 'source' | 'target'): string {
  const binding = view
    .members('bindingsByElement', connector.id)
    .map((id) => view.get(id) as Bound | undefined)
    .find((b) => b?.connectorId === connector.id && b.end === end);
  return (binding?.elementId === undefined ? undefined : nameIn(view, binding.elementId)) ?? 'a free end';
}

/** "A connects to B: label" for a connector, with its labels' text after the colon. */
export function connectorText(element: ElementRecord, view: ReadView): string | undefined {
  const connector = element as ConnectorElement;
  const labels = (connector.labels ?? []).map((l) => textOf(l.text)).filter(Boolean);
  const relation = `${endName(view, connector, 'source')} connects to ${endName(view, connector, 'target')}`;
  return labels.length === 0 ? relation : `${relation}: ${labels.join(', ')}`;
}

/** An image's alt text: its semantic label (nothing when it has none: the picture is then decoration). */
export function imageAlt(element: ElementRecord): string | undefined {
  return (element as unknown as Named).semantic?.label?.trim() || undefined;
}
