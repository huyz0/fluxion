// Mermaid flowcharts (ADR-0040): nodes, the four link styles with labels, chains and subgraphs.
import { type EdgeSpec, type GroupSpec, layered, type NodeSpec, type ScreenSpec } from '../emit.js';
import { type ParseCtx, plain, type Report, type Slugs, type SourceLine } from '../source.js';

const DIRECTIONS: Readonly<Record<string, 'down' | 'right' | 'up' | 'left'>> = { TD: 'down', TB: 'down', LR: 'right', RL: 'left', BT: 'up' };

/** Opening and closing text of a node, and the shape it means; longer openers first. */
const BRACKETS: readonly (readonly [string, string, string])[] = [
  ['((', '))', 'ellipse'],
  ['([', '])', 'ellipse'],
  ['[(', ')]', 'cylinder'],
  ['[[', ']]', 'rect'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['[\\', '\\]', 'parallelogram'],
  ['(', ')', 'rounded-rect'],
  ['[', ']', 'rect'],
  ['{', '}', 'diamond'],
  ['>', ']', 'rect'],
];

type Read = { readonly id: string; readonly shape?: string; readonly label?: string; readonly end: number };

/** A node at `at` in `s`: its id and, when written, its brackets and text. */
function readNode(s: string, at: number): Read | undefined {
  const id = /^[A-Za-z_][\w]*/.exec(s.slice(at))?.[0];
  if (id === undefined) return undefined;
  const p = at + id.length;
  for (const [open, close, shape] of BRACKETS) {
    if (!s.startsWith(open, p)) continue;
    const stop = s.indexOf(close, p + open.length);
    if (stop >= 0) return { id, shape, label: plain(s.slice(p + open.length, stop)), end: stop + close.length };
  }
  return { id, end: p };
}

const LINK = /^(<?)(?:--+>|---+|-\.+->|-\.+-|==+>|===+|--[xo])/;
const IGNORED = /^(style|classDef|class|click|linkStyle|direction|accTitle|accDescr)\b/;
const TEXT_LINK = /^(<?)(?:--|==)\s+(.+?)\s+(--+>|---+|==+>|===+)/;

type Link = { readonly op: string; readonly label?: string; readonly end: number };

function opOf(matched: string): string {
  const arrow = matched.endsWith('>') || /[xo]$/.test(matched);
  if (matched.startsWith('<') && arrow) return '<->';
  if (arrow) return matched.includes('.') ? '~>' : '->';
  return '--';
}

/** A link at `at`: its op, and its text when written as `|text|` or `-- text -->`. */
function readLink(s: string, at: number): Link | undefined {
  const rest = s.slice(at);
  const text = TEXT_LINK.exec(rest);
  if (text) return { op: opOf(`${text[1] ?? ''}${text[3] ?? ''}`), label: plain(text[2] ?? ''), end: at + text[0].length };
  const m = LINK.exec(rest);
  if (!m) return undefined;
  const end = at + m[0].length;
  const bar = /^\s*\|([^|]*)\|/.exec(s.slice(end));
  return { op: opOf(m[0]), ...(bar ? { label: plain(bar[1] ?? '') } : {}), end: end + (bar?.[0].length ?? 0) };
}

type Def = { slug: string; shape: string; label: string };
type Open = { readonly slug: string; readonly label: string; readonly contains: string[] };

/** The state of one flowchart import. */
class Chart {
  readonly defs = new Map<string, Def>();
  readonly edges: EdgeSpec[] = [];
  readonly groups: GroupSpec[] = [];
  readonly stack: Open[] = [];
  private readonly placed = new Set<string>();

  private readonly slugs: Slugs;

  constructor(slugs: Slugs) {
    this.slugs = slugs;
  }

  /** Records a node mention, a later bracket text replacing an earlier one, and files it under the open subgraph. */
  node(n: Read): string {
    let def = this.defs.get(n.id);
    if (!def) {
      def = { slug: this.slugs.slug(n.id), shape: 'rect', label: n.id };
      this.defs.set(n.id, def);
    }
    if (n.shape !== undefined) {
      def.shape = n.shape;
      def.label = n.label ?? n.id;
    }
    const top = this.stack[this.stack.length - 1];
    if (top && !this.placed.has(def.slug)) {
      top.contains.push(def.slug);
      this.placed.add(def.slug);
    }
    return def.slug;
  }

  open(id: string, label: string): void {
    this.stack.push({ slug: this.slugs.slug(`group:${id}`, id), label, contains: [] });
  }

  /** Closes the innermost subgraph; false when none is open. */
  close(): Open | undefined {
    const g = this.stack.pop();
    if (!g) return undefined;
    if (g.contains.length > 0) {
      this.groups.push({ slug: g.slug, label: g.label, contains: g.contains });
      this.stack[this.stack.length - 1]?.contains.push(g.slug);
    }
    return g;
  }
}

/** The link and the node after position `at`, or undefined when what follows is not `link node`. */
function readStep(s: string, at: number): { link: Link; node: Read } | undefined {
  const link = readLink(s, at);
  if (!link) return undefined;
  let p = link.end;
  while (s[p] === ' ') p++;
  const node = readNode(s, p);
  return node ? { link, node } : undefined;
}

/** One statement (`a --> b --> c`): false when it cannot be read. */
function statement(chart: Chart, s: string): boolean {
  const first = readNode(s, 0);
  if (!first) return false;
  let prev = chart.node(first);
  let at = first.end;
  for (;;) {
    while (s[at] === ' ') at++;
    if (at >= s.length) return true;
    const step = readStep(s, at);
    if (!step) return false;
    const next = chart.node(step.node);
    chart.edges.push({ from: prev, to: next, op: step.link.op, ...(step.link.label ? { label: step.link.label } : {}) });
    prev = next;
    at = step.node.end;
  }
}

/** The `;`-separated statements of a line. */
function statements(chart: Chart, text: string, l: SourceLine, report: Report): void {
  for (const part of text
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (part.includes('&')) report.unsupported(l, 'a `&` list of nodes');
    else if (!statement(chart, part)) report.syntax(l, `cannot read the flowchart statement "${part}"`);
  }
}

/** One body line. */
function bodyLine(chart: Chart, l: SourceLine, report: Report): void {
  const text = l.text.trim();
  if (text === '' || text.startsWith('%%')) return;
  if (IGNORED.test(text)) report.unsupported(l, `\`${text.split(/\s/)[0]}\``);
  else if (/^subgraph\b/.test(text)) openSubgraph(chart, text.slice(8).trim());
  else if (text !== 'end') statements(chart, text, l, report);
  else if (!chart.close()) report.syntax(l, '`end` without a `subgraph`');
}

function openSubgraph(chart: Chart, rest: string): void {
  const m = /^([\w-]+)\s*\[(.*)\]$/.exec(rest);
  if (m) chart.open(m[1] ?? 'group', plain(m[2] ?? ''));
  else chart.open(plain(rest) || 'group', plain(rest) || 'group');
}

/** The screen of a flowchart: `header` is its first line, `body` the lines after it. */
export function parseFlowchart(header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx): ScreenSpec | undefined {
  const { report, slugs, id, title } = ctx;
  const dir = header.text.trim().split(/\s+/)[1];
  const chart = new Chart(slugs);
  for (const l of body) bodyLine(chart, l, report);
  for (const g of chart.stack.splice(0)) report.syntax(header, `the subgraph "${g.label}" is never closed with \`end\``);
  if (chart.defs.size === 0) {
    report.syntax(header, 'the flowchart has no nodes');
    return undefined;
  }
  const nodes: NodeSpec[] = [...chart.defs.values()].map((d) => ({ slug: d.slug, shape: d.shape, label: d.label }));
  return { id, title, layout: layered(DIRECTIONS[dir ?? 'TD'] ?? 'down'), nodes, groups: chart.groups, edges: chart.edges };
}
