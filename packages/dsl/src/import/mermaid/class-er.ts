// Mermaid class and ER diagrams, lite (ADR-0040): a class or entity is a box whose text is its name and member lines; a relationship is an edge.
import type { EdgeSpec, NodeSpec, ScreenSpec } from '../emit.js';
import { layered } from '../emit.js';
import { type ParseCtx, plain, type Report, type Slugs, type SourceLine } from '../source.js';

/** Boxes by name, their member lines, and the order they appeared in. */
class Boxes {
  readonly members = new Map<string, string[]>();
  private readonly slugs: Slugs;

  constructor(slugs: Slugs) {
    this.slugs = slugs;
  }

  slug(name: string): string {
    if (!this.members.has(name)) this.members.set(name, []);
    return this.slugs.slug(name);
  }

  add(name: string, line: string): void {
    this.slug(name);
    this.members.get(name)?.push(line.trim());
  }

  nodes(): NodeSpec[] {
    return [...this.members].map(([name, lines]) => ({ slug: this.slugs.slug(name), shape: 'rect', label: [name, ...lines].join('\n') }));
  }
}

/** The name a `Name {` or `class Name {` line opens, if it does. */
const blockStart = (text: string): string | undefined => /^(?:class\s+)?([\w-]+)\s*\{\s*$/.exec(text)?.[1];

/** One line inside a block: `}` closes it, anything else is a member. Returns the block still open. */
function member(text: string, name: string, boxes: Boxes): string | undefined {
  if (text === '}') return undefined;
  boxes.add(name, text);
  return name;
}

/** Blocks `Name { ... }` and `class Name {` ... `}`: the member lines until `}`. Lines outside blocks go to `rest`. */
function readBlocks(body: readonly SourceLine[], boxes: Boxes, rest: (l: SourceLine) => void): void {
  let open: string | undefined;
  for (const l of body) {
    const text = l.text.trim();
    if (text === '' || text.startsWith('%%')) continue;
    if (open !== undefined) {
      open = member(text, open, boxes);
      continue;
    }
    open = blockStart(text);
    if (open !== undefined) boxes.slug(open);
    else rest(l);
  }
}

const CLASS_REL =
  /^([\w-]+)\s*(?:"([^"]*)")?\s*(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|<--|-->|<\.\.|\.\.>|--|\.\.)\s*(?:"([^"]*)")?\s*([\w-]+)(?:\s*:\s*(.*))?$/;

function classEdge(m: RegExpExecArray, boxes: Boxes): EdgeSpec {
  const [, a = '', ca, op = '--', cb, b = '', text = ''] = m;
  const reversed = op.startsWith('<');
  const dotted = op.includes('.');
  const arrow = op.includes('>') || op.includes('|');
  const cards = [ca, cb].filter(Boolean).join(' to ');
  const label = [plain(text), cards].filter(Boolean).join(' ');
  const [from, to] = reversed ? [b, a] : [a, b];
  const e = { from: boxes.slug(from), to: boxes.slug(to), op: arrow ? (dotted ? '~>' : '->') : '--' };
  return label === '' ? e : { ...e, label };
}

/** The screen of a class diagram. */
export function parseClass(header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx): ScreenSpec | undefined {
  const { report, slugs, id, title } = ctx;
  const boxes = new Boxes(slugs);
  const edges: EdgeSpec[] = [];
  readBlocks(body, boxes, (l) => {
    const text = l.text.trim();
    const rel = CLASS_REL.exec(text);
    const member = /^([\w-]+)\s*:\s*(.+)$/.exec(text);
    const decl = /^class\s+([\w-]+)\s*$/.exec(text);
    if (rel) edges.push(classEdge(rel, boxes));
    else if (decl) boxes.slug(decl[1] ?? '');
    else if (member) boxes.add(member[1] ?? '', member[2] ?? '');
    else if (/^(direction|note|click|link|callback|style|cssClass|classDef)\b/.test(text)) report.unsupported(l, `\`${text.split(/\s/)[0]}\``);
    else report.syntax(l, `cannot read the class diagram line "${text}"`);
  });
  if (boxes.members.size === 0) {
    report.syntax(header, 'the class diagram has no classes');
    return undefined;
  }
  return { id, title, layout: layered('down'), nodes: boxes.nodes(), groups: [], edges };
}

const CARDS: Readonly<Record<string, string>> = { '||': '1', 'o|': '0..1', '|o': '0..1', '}o': '0..*', 'o{': '0..*', '}|': '1..*', '|{': '1..*' };
const ER_REL = /^([\w-]+)\s+([|}o][|o])(--|\.\.)([|o][|{])\s+([\w-]+)\s*:\s*(.*)$/;

/** The screen of an ER diagram. */
export function parseEr(header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx): ScreenSpec | undefined {
  const { report, slugs, id, title } = ctx;
  const boxes = new Boxes(slugs);
  const edges: EdgeSpec[] = [];
  readBlocks(body, boxes, (l) => {
    const text = l.text.trim();
    const rel = ER_REL.exec(text);
    if (!rel) return report.syntax(l, `cannot read the ER diagram line "${text}"`);
    const [, a = '', left = '', line = '--', right = '', b = '', label = ''] = rel;
    const cards = `${CARDS[left] ?? left} to ${CARDS[right] ?? right}`;
    edges.push({ from: boxes.slug(a), to: boxes.slug(b), op: line === '..' ? '~>' : '--', label: `${plain(label)} (${cards})` });
  });
  if (boxes.members.size === 0) {
    report.syntax(header, 'the ER diagram has no entities');
    return undefined;
  }
  return { id, title, layout: layered('right'), nodes: boxes.nodes(), groups: [], edges };
}
