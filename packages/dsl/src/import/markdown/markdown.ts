// The Markdown outline importer (FR-IMP-002, ADR-0040): `mdast-util-from-markdown` parses; headings and rules make screens, paragraphs and
// bullets make text nodes (nested bullets a tree), a fenced `mermaid` block goes through the Mermaid importer and makes a diagram screen.
// Only headings, lists, paragraphs and code are read; everything else is skipped with FLX_IMPORT_UNSUPPORTED.
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { DslDiagnostic } from '../../types.js';
import { type EdgeSpec, emitFlux, layered, type NodeSpec, type ScreenSpec } from '../emit.js';
import { parseMermaid } from '../mermaid/mermaid.js';
import { Report, Slugs, type SourceLine } from '../source.js';
import type { ImportOptions, ImportResult } from '../types.js';

type Point = { readonly line: number; readonly offset?: number | undefined };
/** The parts of an mdast node the importer reads. */
type MNode = {
  readonly type: string;
  readonly children?: readonly MNode[] | undefined;
  readonly value?: string | undefined;
  readonly depth?: number | undefined;
  readonly lang?: string | null | undefined;
  readonly ordered?: boolean | null | undefined;
  readonly alt?: string | null | undefined;
  readonly position?: { readonly start: Point; readonly end: Point } | undefined;
};

/** A screen being filled. */
type Draft = { id: string; title: string; nodes: NodeSpec[]; edges: EdgeSpec[]; fromRule: boolean };

/** The text of a node and its children, images as their alt text. */
function inlineText(n: MNode): string {
  if (n.type === 'image') return n.alt ?? '';
  if (n.type === 'break') return '\n';
  if (n.value !== undefined) return n.value;
  return (n.children ?? []).map(inlineText).join('');
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

class Outline {
  readonly screens: ScreenSpec[] = [];
  deckTitle: string | undefined;
  private cur: Draft | undefined;
  private lastTitle: string | undefined;
  private readonly source: string;
  private readonly report: Report;
  private readonly slugs = new Slugs();

  constructor(source: string, report: Report) {
    this.source = source;
    this.report = report;
  }

  block(n: MNode): void {
    switch (n.type) {
      case 'heading':
        this.heading(n);
        break;
      case 'thematicBreak':
        this.rule();
        break;
      case 'paragraph':
        this.paragraph(n);
        break;
      case 'list':
        this.list(n, undefined);
        break;
      case 'code':
        this.code(n);
        break;
      default:
        this.skip(n, n.type === 'html' ? 'raw HTML' : `a ${n.type}`);
    }
  }

  finish(): void {
    this.flush();
  }

  private lineOf(n: MNode): SourceLine {
    const line = n.position?.start.line ?? 1;
    return { text: this.source.split('\n')[line - 1] ?? '', line, offset: n.position?.start.offset ?? 0 };
  }

  private skip(n: MNode, what: string): void {
    this.report.unsupported(this.lineOf(n), what);
  }

  private draft(title?: string): Draft {
    if (this.cur) return this.cur;
    const fromRule = title === undefined;
    const t = title ?? `Screen ${this.screens.length + 1}`;
    this.lastTitle = t;
    this.cur = { id: this.slugs.fresh(t), title: t, nodes: [], edges: [], fromRule };
    return this.cur;
  }

  private flush(): void {
    const d = this.cur;
    this.cur = undefined;
    if (!d) return;
    if (d.nodes.length === 0) d.nodes.push({ slug: this.slugs.fresh(d.title), shape: 'rounded-rect', label: d.title });
    const layout = d.edges.length > 0 ? layered('down') : '{ type: stack, direction: down, gap: 24 }';
    this.screens.push({ id: d.id, title: d.title, layout, nodes: d.nodes, groups: [], edges: d.edges });
  }

  private heading(n: MNode): void {
    const text = squash(inlineText(n));
    const depth = n.depth ?? 1;
    if (depth >= 3) {
      this.addNode(text, 'rect');
      return;
    }
    if (depth === 1 && this.deckTitle === undefined) this.deckTitle = text;
    if (this.cur?.fromRule && this.cur.nodes.length === 0) {
      this.cur.title = text;
      return;
    }
    this.flush();
    this.draft(text);
  }

  private rule(): void {
    this.flush();
    this.draft();
  }

  private addNode(label: string, shape: string): string {
    const d = this.draft(this.screens.length === 0 ? (this.deckTitle ?? 'Overview') : undefined);
    const slug = this.slugs.fresh(label);
    d.nodes.push({ slug, shape, label });
    return slug;
  }

  private paragraph(n: MNode): void {
    const text = squash(inlineText(n));
    if ((n.children ?? []).some((c) => c.type === 'image')) this.skip(n, 'an image (images are not yet part of FluxScript)');
    if (text !== '') this.addNode(text, 'rounded-rect');
  }

  private list(n: MNode, parent: string | undefined): void {
    let previous: string | undefined;
    for (const item of n.children ?? []) {
      const slug = this.item(item, parent);
      if (n.ordered && previous !== undefined && parent === undefined) this.draft().edges.push({ from: previous, to: slug, op: '->' });
      previous = slug;
    }
  }

  private item(item: MNode, parent: string | undefined): string {
    const own = (item.children ?? []).filter((c) => c.type === 'paragraph');
    const slug = this.addNode(squash(own.map(inlineText).join(' ')) || 'Item', 'rounded-rect');
    if (parent !== undefined) this.draft().edges.push({ from: parent, to: slug, op: '->' });
    for (const c of item.children ?? []) {
      if (c.type === 'list') this.list(c, slug);
      else if (c.type !== 'paragraph') this.skip(c, `a ${c.type} inside a list`);
    }
    return slug;
  }

  private code(n: MNode): void {
    if (n.lang?.toLowerCase() === 'mermaid') this.diagram(n);
    else this.addNode(n.value ?? '', 'document');
  }

  /** The title a diagram screen takes: the open screen's, which the diagram then replaces when that screen is still empty. */
  private diagramTitle(): string {
    const title = this.cur?.title ?? this.lastTitle ?? this.deckTitle ?? 'Diagram';
    if (this.cur && this.cur.nodes.length === 0) this.cur = undefined;
    else this.flush();
    return title;
  }

  private diagram(n: MNode): void {
    const title = this.diagramTitle();
    const start = n.position?.start;
    const from = start?.offset ?? 0;
    const at = { line: start?.line ?? 0, offset: from + this.source.slice(from).indexOf('\n') + 1 };
    const screen = parseMermaid(n.value ?? '', { report: this.report, slugs: this.slugs, id: this.slugs.fresh(title), title, at });
    if (screen) this.screens.push(screen);
  }
}

/**
 * Imports a Markdown outline as a FluxScript file: the level-1 heading is the deck title and opens the first screen, each level-2 heading or
 * `---` rule starts a screen, paragraphs and bullets become text nodes (nested bullets a tree, ordered bullets a chain), a code fence becomes a
 * document node, and a fenced `mermaid` block becomes a diagram screen. Raw HTML, tables, quotes and images are skipped with
 * `FLX_IMPORT_UNSUPPORTED`. The text is returned for the compiler to validate and lay out; it is not compiled here.
 *
 * @param text - the Markdown source
 * @param options - the deck title when the file has no level-1 heading
 * @returns the FluxScript file, or the diagnostics that stopped it
 * @public
 */
export function importMarkdown(text: string, options: ImportOptions = {}): ImportResult {
  const report = new Report('Markdown');
  const outline = new Outline(text, report);
  for (const n of fromMarkdown(text).children) outline.block(n);
  outline.finish();
  const empty: SourceLine = { text: '', line: 1, offset: 0 };
  if (outline.screens.length === 0 && !report.failed) report.syntax(empty, 'the Markdown has no heading, paragraph, list or diagram to import');
  const diagnostics: readonly DslDiagnostic[] = report.items;
  if (report.failed) return { ok: false, diagnostics };
  return { ok: true, flux: emitFlux(options.title ?? outline.deckTitle ?? 'Imported outline', outline.screens), diagnostics };
}
