// Putting what a template built (FR-LAY-014, ADR-0047) into a patch's working records: each shape pinned where the template placed it, each
// connector straight between its shapes, with the ids a compile of the same screen would make (a node by its slug, an edge by its key).

import { type CoreRegistries, idKeys } from '@fluxion/core';
import { buildTemplate, type TemplateDef, type TemplateResult } from '@fluxion/layout';
import { DEFAULT_SCREEN_SIZE, type RecordId, type RichTextDoc } from '@fluxion/schema';
import { anchorOf, opStyle, styleOf } from '../expand/style.js';
import type { LocatedStyle } from '../read/ast.js';
import { toSlug } from '../resolve/suggest.js';
import { builtSlug, draftStyle, ESTIMATE, isTemplate, itemsOfSpec, roleOf } from '../template/lower.js';
import type { LayoutIntent } from './schema.js';

type Rec = { [key: string]: unknown };

/** Text as a rich-text document: one paragraph per line. */
export function richText(text: string): RichTextDoc {
  const paragraph = (line: string) => (line === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: line }] });
  return { type: 'doc', content: text.split(/\r?\n/).map(paragraph) };
}

/** What `putTemplate` asks of the lowering it runs in. */
export type TemplateHost = {
  /** The stable id of a key. */
  readonly id: (key: string) => RecordId;
  /** Put a record in the working copy. */
  readonly put: (record: Rec) => void;
  /** The order key after the screen's last element. */
  readonly indexAfterLast: () => string;
  /** The registered id of a shape name. */
  readonly shapeId: (name: string) => string | undefined;
};

/** The built template and where it goes: the screen's id and its slug (the key edges are named under). */
export type TemplatePlace = {
  readonly def: TemplateDef<unknown>;
  readonly built: TemplateResult;
  readonly screenId: string;
  readonly slug: string;
};

/** A template built for a screen, and the layout record that names it; nothing when the registry lacks it or refuses the items (resolve says so first). */
export function buildFor(
  registries: CoreRegistries | undefined,
  layout: LayoutIntent,
): { readonly def: TemplateDef<unknown>; readonly built: TemplateResult; readonly layout: Rec } | undefined {
  const { id, items, options } = layout;
  const def = registries?.templates.get(id as string);
  if (!isTemplate(def)) return undefined;
  // the frame compile and resolve build at, so a decompile and recompile rebuild the same boxes
  const frame = { x: 0, y: 0, ...DEFAULT_SCREEN_SIZE };
  const built = buildTemplate(def, itemsOfSpec(items), options, { frame, measure: ESTIMATE });
  if (!built.ok) return undefined;
  return {
    def,
    built: built.value,
    layout: { type: 'template', id: def.id, items: itemsOfSpec(items), ...(options && Object.keys(options).length > 0 ? { options } : {}) },
  };
}

function putShapes(host: TemplateHost, { def, built, screenId, slug: screen }: TemplatePlace): Map<string, string> {
  const ids = new Map<string, string>();
  for (const d of built.shapes) {
    const defId = host.shapeId(d.shape);
    const style = styleOf({ style: { value: draftStyle(d.style) } as unknown as LocatedStyle, tone: roleOf(def, d.slot) });
    const slug = builtSlug(screen, d.key);
    const elementId = host.id(idKeys.node(slug));
    ids.set(d.key, elementId);
    host.put({
      id: elementId,
      type: 'element',
      screenId,
      kind: 'shape',
      ...(defId ? { defId } : {}),
      index: host.indexAfterLast(),
      semantic: { slug, label: d.label, template: { id: def.id, slot: d.slot, index: d.index } },
      text: richText(d.detail === undefined ? d.label : `${d.label}\n${d.detail}`),
      ...(style ? { style } : {}),
      ...(d.params ? { params: d.params } : {}),
      placement: 'pinned',
      transform: { x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h },
    });
  }
  return ids;
}

function putConnectors(host: TemplateHost, { def, built, screenId, slug }: TemplatePlace, ids: ReadonlyMap<string, string>): void {
  for (const c of built.connectors) {
    const key = idKeys.edge({ screen: slug, from: builtSlug(slug, c.from), op: '->', to: builtSlug(slug, c.to), n: 1 });
    const connectorId = host.id(key);
    const style = styleOf({ style: { value: { stroke: c.style.stroke.color as string, 'stroke.width': c.style.stroke.width } } as unknown as LocatedStyle });
    host.put({
      id: connectorId,
      type: 'element',
      screenId,
      kind: 'connector',
      index: host.indexAfterLast(),
      route: { type: 'straight' },
      markers: opStyle('->').markers,
      semantic: { template: { id: def.id } },
      ...(style ? { style } : {}),
    });
    for (const [end, shape] of [
      ['source', c.from],
      ['target', c.to],
    ] as const)
      host.put({ id: host.id(`${key}:${end}`), type: 'binding', connectorId, end, elementId: ids.get(shape) as string, anchor: anchorOf(undefined) });
  }
}

/** Put the shapes and then the connectors of a built template, in the order a compile makes them. */
export function putTemplate(host: TemplateHost, place: TemplatePlace): void {
  putConnectors(host, place, putShapes(host, place));
}

/** The ids of the records an earlier build of the screen made: the elements with a `semantic.template`, and the bindings of its connectors. */
export function builtBy(records: Iterable<Rec>, screenId: string): Set<string> {
  const all = [...records];
  const made = new Set(
    all.filter((r) => r['screenId'] === screenId && (r['semantic'] as { template?: unknown } | undefined)?.template).map((r) => r['id'] as string),
  );
  for (const r of all) if (r['type'] === 'binding' && made.has(r['connectorId'] as string)) made.add(r['id'] as string);
  return made;
}

/**
 * The slug a template built on a screen is named under: the screen's own, else its id made into one (a slug is lower case, digits and hyphens, and
 * starts with a letter), so a screen made in the editor, which has no slug and a random id, still gets valid node slugs.
 */
export function screenSlugOf(screen: Rec, screenId: string): string {
  const own = (screen['meta'] as { slug?: string } | undefined)?.slug;
  return own ?? toSlug(screenId) ?? 'screen';
}
