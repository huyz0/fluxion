// FluxScript text for an imported diagram (ADR-0040): a small model of one screen, written as the flow-style YAML the cheat sheet shows, so the
// compiler (not the importer) validates and lays it out. Strings are JSON-quoted, which is valid YAML.

/** One node of a screen. */
export type NodeSpec = { readonly slug: string; readonly shape: string; readonly label: string };

/** One group, listing the node and group slugs it holds. */
export type GroupSpec = { readonly slug: string; readonly label: string; readonly contains: readonly string[] };

/** One edge: `->` `--` `~>` `<->` or `<-`. */
export type EdgeSpec = { readonly from: string; readonly to: string; readonly op: string; readonly label?: string };

/** One screen of an import. */
export type ScreenSpec = {
  readonly id: string;
  readonly title: string;
  /** The layout as a flow mapping, e.g. `{ type: layered, direction: right }`. */
  readonly layout: string;
  readonly nodes: readonly NodeSpec[];
  readonly groups: readonly GroupSpec[];
  readonly edges: readonly EdgeSpec[];
};

const q = (s: string): string => JSON.stringify(s);

/** The layered layout in a direction. */
export const layered = (direction: 'down' | 'right' | 'up' | 'left'): string => `{ type: layered, direction: ${direction} }`;

/** The stack layout in a row. */
export const ROW = '{ type: stack, direction: right, gap: 80 }';

const nodeLine = (n: NodeSpec): string => `      ${n.slug}: { shape: ${n.shape}${n.label === '' ? '' : `, label: ${q(n.label)}`} }`;
const groupLine = (g: GroupSpec): string =>
  `      ${g.slug}: { label: ${q(g.label)}, contains: [${g.contains.join(', ')}], layout: { type: stack, direction: down, gap: 24 } }`;
const edgeLine = (e: EdgeSpec): string =>
  e.label === undefined || e.label === ''
    ? `      - ${e.from} ${e.op} ${e.to}`
    : `      - { from: ${e.from}, to: ${e.to}, op: ${q(e.op)}, label: ${q(e.label)} }`;

/** One `screens:` item. */
export function emitScreen(s: ScreenSpec): string {
  const parts = [`  - id: ${s.id}`, `    title: ${q(s.title)}`, `    layout: ${s.layout}`, '    nodes:', ...s.nodes.map(nodeLine)];
  if (s.groups.length > 0) parts.push('    groups:', ...s.groups.map(groupLine));
  if (s.edges.length > 0) parts.push('    edges:', ...s.edges.map(edgeLine));
  return `${parts.join('\n')}\n`;
}

/** A whole file: the header, then the screens. */
export function emitFlux(title: string, screens: readonly ScreenSpec[]): string {
  return `flux: 1\ntitle: ${q(title)}\nuses: [basic]\nscreens:\n${screens.map(emitScreen).join('')}`;
}
