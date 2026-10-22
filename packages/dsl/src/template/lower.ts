// Template lowering (FR-LAY-014, ADR-0047): a screen that names a template (`template:` with `items:` and `options:`) is built by the
// registry's `TemplateDef` into pinned nodes and the edges between them, which the later stages compile like any written ones. The frame
// is the default screen's; text is measured by a fixed estimate, so the same text always builds the same screen (no host measurer, no clock).
import type { CoreRegistries, TextMeasurer } from '@fluxion/core';
import { buildTemplate, type TemplateDef, type TemplateResult } from '@fluxion/layout';
import { DEFAULT_SCREEN_SIZE, DIAGNOSTIC_CODES } from '@fluxion/schema';
import type { Edge } from '../parse/edge.js';
import type { TemplateItemSpec } from '../patch/schema.js';
import type { FluxAst, NodeAst, ScreenAst, StyleAst, TemplateItemAst } from '../read/ast.js';
import { nearest } from '../resolve/suggest.js';
import type { DslDiagnostic, SourceRange } from '../types.js';

/** The width of an average character as a share of the font size, and a line's height as a multiple of it. */
const CHAR = 0.55;
const LINE = 1.2;

/** The text measurer templates are built with here: a fixed estimate. */
export const ESTIMATE: TextMeasurer = {
  measure: (text, font) => {
    const lines = text.split('\n');
    const widest = Math.max(...lines.map((l) => [...l].length));
    const line = font.size * (font.lineHeight ?? LINE);
    return { width: widest * font.size * CHAR, height: lines.length * line, ascent: font.size, descent: line - font.size };
  },
};

/** Whether a `templates` registry value is a template definition. */
export const isTemplate = (v: unknown): v is TemplateDef<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as TemplateDef<unknown>).build === 'function' && typeof (v as TemplateDef<unknown>).items === 'object';

/** The slug of a node a template built on a screen: the screen's id before the draft key, so two screens can use one template. */
export const builtSlug = (screen: string, key: string): string => `${screen}-${key}`;

/** The role a draft's slot plays: the tone its shape is styled with. */
export const roleOf = (def: TemplateDef<unknown>, slot: string): string => def.slots[slot]?.role ?? slot;

/** A draft's style as a FluxScript style map: token references stay as written, so the style stage keeps them. */
export function draftStyle(s: TemplateResult['shapes'][number]['style']): StyleAst {
  return {
    ...(s.fill === undefined ? {} : { fill: s.fill as string }),
    stroke: s.stroke.color as string,
    'stroke.width': s.stroke.width,
    ...(s.font ? { 'font.color': s.font.color as string } : {}),
    ...(s.opacity === undefined ? {} : { opacity: s.opacity }),
  };
}

/** The nodes and edges a built template is, anchored at `at` in the source. */
function lowered(def: TemplateDef<unknown>, built: TemplateResult, at: SourceRange, screen: string): Pick<ScreenAst, 'nodes' | 'edges'> {
  const nodes = built.shapes.map(
    (d): NodeAst => ({
      slug: { value: builtSlug(screen, d.key), range: at },
      shape: { value: d.shape, range: at },
      label: { value: d.detail === undefined ? d.label : `${d.label}\n${d.detail}`, range: at },
      tone: { value: roleOf(def, d.slot), range: at },
      style: { value: draftStyle(d.style), range: at },
      pin: { value: { x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h }, range: at },
      template: { id: def.id, slot: d.slot, index: d.index },
      ...(d.params ? { params: d.params } : {}),
    }),
  );
  const edges = built.connectors.map((c) => {
    const edge: Edge = { from: { slug: builtSlug(screen, c.from), col: 1 }, op: '->', to: { slug: builtSlug(screen, c.to), col: 1 } };
    const style: StyleAst = { stroke: c.style.stroke.color as string, 'stroke.width': c.style.stroke.width };
    return { edge, range: at, ends: { from: at, to: at }, style: { value: style, range: at }, template: def.id };
  });
  return { nodes, edges };
}

type Lowered = { readonly screen: ScreenAst; readonly diagnostics: readonly DslDiagnostic[] };

function lowerScreen(s: ScreenAst, index: number, registries: CoreRegistries): Lowered {
  const spec = s.layout;
  if (spec?.type.value !== 'template' || !spec.id) return { screen: s, diagnostics: [] };
  const at = spec.type.range;
  const path = `/screens/${index}/template`;
  const def = registries.templates.get(spec.id.value);
  if (!isTemplate(def)) {
    const near = nearest(
      spec.id.value,
      registries.templates.list().map(([key]) => key),
    );
    const diagnostic: DslDiagnostic = {
      code: 'FLX_REF_MISSING',
      severity: DIAGNOSTIC_CODES.FLX_REF_MISSING,
      path,
      message: `no template "${spec.id.value}" is registered`,
      ...(near ? { hint: `did you mean "${near}"?` } : {}),
      source: spec.id.range,
    };
    return { screen: s, diagnostics: [diagnostic] };
  }
  const built = buildTemplate(def, spec.items ?? [], spec.options, { frame: { x: 0, y: 0, ...DEFAULT_SCREEN_SIZE }, measure: ESTIMATE });
  if (!built.ok)
    return {
      screen: s,
      diagnostics: [{ code: 'FLX_SCHEMA_INVALID', severity: DIAGNOSTIC_CODES.FLX_SCHEMA_INVALID, path, message: built.message, source: at }],
    };
  const more = lowered(def, built.value, at, s.id.value);
  return { screen: { ...s, nodes: [...s.nodes, ...more.nodes], edges: [...s.edges, ...more.edges] }, diagnostics: [] };
}

/**
 * Build the templates of a read tree: each screen that names one gains the nodes and edges it builds. A template the registry lacks, or
 * items or options it refuses, is a diagnostic at the screen's `template` and leaves the screen as written.
 *
 * @param ast - the tree the read stage gave
 * @param registries - the `templates` registry is where a template id is found
 * @public
 */
export function lowerTemplates(ast: FluxAst, registries: CoreRegistries): { readonly ast: FluxAst; readonly diagnostics: readonly DslDiagnostic[] } {
  const done = ast.screens.map((s, i) => lowerScreen(s, i, registries));
  if (done.every((d, i) => d.screen === ast.screens[i])) return { ast, diagnostics: done.flatMap((d) => d.diagnostics) };
  return { ast: { ...ast, screens: done.map((d) => d.screen) }, diagnostics: done.flatMap((d) => d.diagnostics) };
}

/** The items of a patch's template, each a label or a map, as template items. */
export function itemsOfSpec(items: readonly TemplateItemSpec[] | undefined): TemplateItemAst[] {
  return (items ?? []).map((i) =>
    typeof i === 'string'
      ? { label: i }
      : { label: i.label, ...(i.detail === undefined ? {} : { detail: i.detail }), ...(i.children === undefined ? {} : { children: itemsOfSpec(i.children) }) },
  );
}
