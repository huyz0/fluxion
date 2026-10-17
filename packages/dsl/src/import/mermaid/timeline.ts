// Mermaid timelines (ADR-0040): a chain of periods, each with its events, sections as groups.
import type { EdgeSpec, GroupSpec, NodeSpec, ScreenSpec } from '../emit.js';
import { layered } from '../emit.js';
import { type ParseCtx, plain, type SourceLine } from '../source.js';

/** The periods, events and sections read so far. */
class Line {
  title: string;
  readonly nodes: NodeSpec[] = [];
  readonly edges: EdgeSpec[] = [];
  readonly groups: GroupSpec[] = [];
  private section: { label: string; contains: string[] } | undefined;
  private period: string | undefined;
  private last: string | undefined;
  private readonly ctx: ParseCtx;

  constructor(ctx: ParseCtx) {
    this.ctx = ctx;
    this.title = ctx.title;
  }

  private put(n: NodeSpec): void {
    this.nodes.push(n);
    this.section?.contains.push(n.slug);
  }

  startSection(label: string): void {
    this.endSection();
    this.section = { label, contains: [] };
  }

  endSection(): void {
    const s = this.section;
    if (s && s.contains.length > 0) this.groups.push({ slug: this.ctx.slugs.fresh(s.label), label: s.label, contains: s.contains });
    this.section = undefined;
  }

  /** `when : event : event`, or (with no period yet) the events alone are ignored. */
  entry(when: string, events: readonly string[]): void {
    const p: NodeSpec = { slug: this.ctx.slugs.fresh(when), shape: 'rounded-rect', label: plain(when) };
    this.put(p);
    if (this.last !== undefined) this.edges.push({ from: this.last, to: p.slug, op: '->' });
    this.last = p.slug;
    this.period = p.slug;
    this.events(events);
  }

  events(raw: readonly string[]): void {
    for (const e of raw) {
      const label = plain(e);
      if (label === '' || this.period === undefined) continue;
      const n: NodeSpec = { slug: this.ctx.slugs.fresh(label), shape: 'rect', label };
      this.put(n);
      this.edges.push({ from: this.period, to: n.slug, op: '--' });
    }
  }

  get hasPeriod(): boolean {
    return this.period !== undefined;
  }
}

function handle(t: Line, l: SourceLine, ctx: ParseCtx): void {
  const text = l.text.trim();
  if (text === '' || text.startsWith('%%')) return;
  if (text.startsWith('title ')) t.title = plain(text.slice(6));
  else if (text.startsWith('section ')) t.startSection(plain(text.slice(8)));
  else if (text.startsWith(':') && t.hasPeriod) t.events(text.slice(1).split(':'));
  else if (text.includes(':') && !text.startsWith(':')) {
    const [when = '', ...events] = text.split(':');
    t.entry(when, events);
  } else ctx.report.syntax(l, `cannot read the timeline line "${text}"`);
}

/** The screen of a timeline. */
export function parseTimeline(header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx): ScreenSpec | undefined {
  const t = new Line(ctx);
  for (const l of body) handle(t, l, ctx);
  t.endSection();
  if (t.nodes.length === 0) {
    ctx.report.syntax(header, 'the timeline has no periods');
    return undefined;
  }
  return { id: ctx.id, title: t.title, layout: layered('right'), nodes: t.nodes, groups: t.groups, edges: t.edges };
}
