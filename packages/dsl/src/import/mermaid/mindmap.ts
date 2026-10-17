// Mermaid mindmaps (ADR-0040): an indentation tree; each line is a node joined to its parent.
import { type EdgeSpec, layered, type NodeSpec, type ScreenSpec } from '../emit.js';
import { type ParseCtx, plain, type SourceLine } from '../source.js';
import { bracketText } from './text.js';

type Parent = { readonly indent: number; readonly slug: string };

/** Adds the node of one line under the nearest less-indented line before it. */
function addLine(l: SourceLine, state: { nodes: NodeSpec[]; edges: EdgeSpec[]; parents: Parent[] }, ctx: ParseCtx): void {
  const indent = l.text.length - l.text.trimStart().length;
  const label = plain(bracketText(l.text.trim()));
  const slug = ctx.slugs.fresh(label);
  const { parents, nodes, edges } = state;
  while ((parents[parents.length - 1]?.indent ?? -1) >= indent) parents.pop();
  const parent = parents[parents.length - 1];
  if (parent) edges.push({ from: parent.slug, to: slug, op: '--' });
  else if (nodes.length > 0) ctx.report.syntax(l, 'a second root: a mindmap has one node at its least indentation');
  nodes.push({ slug, shape: parent ? 'rounded-rect' : 'ellipse', label });
  parents.push({ indent, slug });
}

/** The screen of a mindmap. */
export function parseMindmap(header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx): ScreenSpec | undefined {
  const state = { nodes: [] as NodeSpec[], edges: [] as EdgeSpec[], parents: [] as Parent[] };
  for (const l of body) {
    const text = l.text.trim();
    if (text === '' || text.startsWith('%%')) continue;
    if (/^(::icon|:::)/.test(text)) ctx.report.unsupported(l, `\`${text.split('(')[0]}\``);
    else addLine(l, state, ctx);
  }
  if (state.nodes.length === 0) {
    ctx.report.syntax(header, 'the mindmap has no nodes');
    return undefined;
  }
  return { id: ctx.id, title: ctx.title, layout: layered('right'), nodes: state.nodes, groups: [], edges: state.edges };
}
