// Mermaid sequence diagrams, lite (ADR-0040): participants in a row, each message an edge numbered in order, notes as nodes tied to a participant.
// Blocks (alt, loop, opt, par, critical, rect) are flattened: their lines import and the block lines are reported.
import type { EdgeSpec, NodeSpec, ScreenSpec } from '../emit.js';
import { ROW } from '../emit.js';
import { type ParseCtx, plain, type SourceLine } from '../source.js';

const BLOCK = /^(alt|else|opt|loop|par|and|critical|option|break|rect|end)\b/;
const IGNORED = /^(autonumber|activate|deactivate|title|box|link|links|create|destroy)\b/;
const ARROW = /^(\S+?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)(\S+?)\s*:\s*(.*)$/;
const NOTE = /^note\s+(?:left of|right of|over)\s+([^:]+):\s*(.*)$/i;
const DECL = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/;

const OPS: Readonly<Record<string, string>> = { '->>': '->', '-->>': '~>', '->': '--', '-->': '~>', '-x': '->', '--x': '~>', '-)': '->', '--)': '~>' };

/** The participants, notes and messages read so far. */
class Diagram {
  readonly nodes: NodeSpec[] = [];
  readonly edges: EdgeSpec[] = [];
  private readonly people = new Map<string, number>();
  private count = 0;
  private readonly ctx: ParseCtx;

  constructor(ctx: ParseCtx) {
    this.ctx = ctx;
  }

  /** The slug of participant `key`, declared on first use; `label` names it. */
  person(key: string, label?: string): string {
    const at = this.people.get(key);
    const slug = this.ctx.slugs.slug(key);
    if (at === undefined) {
      this.people.set(key, this.nodes.length);
      this.nodes.push({ slug, shape: 'rounded-rect', label: label ?? key });
    } else if (label !== undefined) this.nodes[at] = { slug, shape: 'rounded-rect', label };
    return slug;
  }

  get size(): number {
    return this.people.size;
  }

  message(m: RegExpExecArray): void {
    this.count++;
    const from = this.person(m[1] ?? '');
    const to = this.person(m[4] ?? '');
    this.edges.push({ from, to, op: OPS[m[2] ?? ''] ?? '->', label: `${this.count}. ${plain(m[5] ?? '')}` });
  }

  note(m: RegExpExecArray): void {
    const slug = this.ctx.slugs.fresh('note');
    this.nodes.push({ slug, shape: 'rect', label: plain(m[2] ?? '') });
    this.edges.push({ from: slug, to: this.person((m[1] ?? '').split(',')[0]?.trim() ?? ''), op: '--' });
  }
}

/** One line of the body. */
function line(d: Diagram, l: SourceLine, ctx: ParseCtx): void {
  const text = l.text.trim();
  if (text === '' || text.startsWith('%%')) return;
  const decl = DECL.exec(text);
  const arrow = ARROW.exec(text);
  const note = NOTE.exec(text);
  if (decl) d.person(decl[2] ?? '', plain(decl[3] ?? decl[2] ?? ''));
  else if (arrow) d.message(arrow);
  else if (note) d.note(note);
  else if (BLOCK.test(text) || IGNORED.test(text)) ctx.report.unsupported(l, `\`${text.split(/\s/)[0]}\``);
  else ctx.report.syntax(l, `cannot read the sequence statement "${text}"`);
}

/** The screen of a sequence diagram. */
export function parseSequence(header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx): ScreenSpec | undefined {
  const d = new Diagram(ctx);
  for (const l of body) line(d, l, ctx);
  if (d.size === 0) {
    ctx.report.syntax(header, 'the sequence diagram has no participants');
    return undefined;
  }
  return { id: ctx.id, title: ctx.title, layout: ROW, nodes: d.nodes, groups: [], edges: d.edges };
}
