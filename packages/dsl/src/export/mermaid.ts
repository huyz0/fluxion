// The Mermaid export (FR-EXP-007): the shapes of a screen with their connectors as a `flowchart TD`. Lossy by design: geometry, style,
// animation, groups and everything but the node text, a shape family and the edge text are dropped, and `dropped` counts what could not be written.
import type { DocumentFile } from '@fluxion/schema';
import { plainText, type Rec, recordsOf } from '../lint/view.js';

/** The Mermaid node delimiters of a shape definition: `open` and `close` around the label. */
const DELIMITERS: Readonly<Record<string, readonly [string, string]>> = {
  'basic:rect': ['[', ']'],
  'basic:rounded-rect': ['(', ')'],
  'basic:ellipse': ['([', '])'],
  'basic:diamond': ['{', '}'],
  'basic:hexagon': ['{{', '}}'],
  'basic:cylinder': ['[(', ')]'],
  'basic:parallelogram': ['[/', '/]'],
};

/**
 * What the Mermaid export wrote.
 *
 * @public
 */
export type MermaidExport = {
  /** The Mermaid source; ends with a newline. */
  readonly text: string;
  /** Nodes written. */
  readonly nodes: number;
  /** Edges written. */
  readonly edges: number;
  /** Elements and connectors that have no Mermaid form and were left out. */
  readonly dropped: number;
};

/** A label safe inside a quoted Mermaid string. */
const quote = (text: string): string => `"${text.replace(/"/g, '#quot;').replace(/\n/g, ' ')}"`;

/** The Mermaid line of one node. */
function nodeLine(name: string, rec: Rec): string {
  const [open, close] = DELIMITERS[String(rec['defId'])] ?? DELIMITERS['basic:rect'] ?? ['[', ']'];
  const label = plainText(rec['text']);
  return `  ${name}${open}${quote(label === '' ? name : label)}${close}`;
}

/** The text of the first label of a connector, or ''. */
function edgeLabel(rec: Rec): string {
  const first = (rec['labels'] as readonly { text?: unknown }[] | undefined)?.[0];
  return first === undefined ? '' : plainText(first.text);
}

/** The ids at the source and target end of every connector, from the bindings. */
function connectorEnds(doc: DocumentFile): Map<string, { source?: string; target?: string }> {
  const ends = new Map<string, { source?: string; target?: string }>();
  for (const b of recordsOf(doc, 'binding')) {
    const id = String(b['connectorId']);
    ends.set(id, { ...ends.get(id), [b['end'] as 'source' | 'target']: String(b['elementId']) });
  }
  return ends;
}

/** The edge line of connector `c` between two named nodes, or undefined when an end is not a written node. */
function edgeLine(c: Rec, ends: { source?: string; target?: string } | undefined, names: ReadonlyMap<string, string>): string | undefined {
  const from = names.get(ends?.source ?? '');
  const to = names.get(ends?.target ?? '');
  if (from === undefined || to === undefined) return undefined;
  const label = edgeLabel(c);
  return `  ${from} ${label === '' ? '-->' : `-->|${quote(label)}|`} ${to}`;
}

/**
 * The visible shapes of screen `screenId` (default: the first screen) and the connectors bound at both ends to two of them, as a Mermaid
 * `flowchart TD`. Nodes are named `n1`, `n2`… in id order; a connector with a free end, a hidden or other-kind element is counted in `dropped`.
 *
 * @public
 */
export function toMermaid(doc: DocumentFile, screenId?: string): MermaidExport {
  const screen = screenId ?? recordsOf(doc, 'screen')[0]?.id;
  const own = recordsOf(doc, 'element').filter((e) => e['screenId'] === screen && e['hidden'] !== true);
  const byKind = new Map<string, Rec[]>();
  for (const e of own) byKind.set(String(e['kind']), [...(byKind.get(String(e['kind'])) ?? []), e]);
  const shapes = byKind.get('shape') ?? [];
  const connectors = byKind.get('connector') ?? [];
  const names = new Map(shapes.map((s, i) => [s.id, `n${i + 1}`]));
  const ends = connectorEnds(doc);
  const edges = connectors.flatMap((c) => edgeLine(c, ends.get(c.id), names) ?? []);
  const lines = ['flowchart TD', ...shapes.map((s) => nodeLine(names.get(s.id) as string, s)), ...edges];
  return {
    text: `${lines.join('\n')}\n`,
    nodes: shapes.length,
    edges: edges.length,
    dropped: own.length - shapes.length - edges.length,
  };
}
