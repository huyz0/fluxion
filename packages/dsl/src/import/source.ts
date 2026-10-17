// Source lines and the diagnostics an importer raises on them (FLX_IMPORT_*), plus unique slugs.
import type { DslDiagnostic } from '../types.js';

/** One line of source with its 1-based number and the offset of its first character. */
export type SourceLine = { readonly text: string; readonly line: number; readonly offset: number };

/** Where an embedded source starts inside a larger file: the lines and characters before it. */
export type SourceOrigin = { readonly line: number; readonly offset: number };

/** The lines of `text`, comments (`%%`) and blank lines kept so numbers stay true. */
export function sourceLines(text: string, at: SourceOrigin = { line: 0, offset: 0 }): SourceLine[] {
  const out: SourceLine[] = [];
  let offset = at.offset;
  for (const [i, raw] of text.split('\n').entries()) {
    const clean = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    out.push({ text: clean, line: at.line + i + 1, offset });
    offset += raw.length + 1;
  }
  return out;
}

/** A collector of import diagnostics. */
export class Report {
  readonly items: DslDiagnostic[] = [];
  private readonly subset: string;

  /** A collector whose "outside the supported ... subset" warnings name `subset`. */
  constructor(subset = 'Mermaid') {
    this.subset = subset;
  }

  /** A warning: the line is skipped or simplified, the rest imports. */
  unsupported(l: SourceLine, what: string): void {
    this.add('FLX_IMPORT_UNSUPPORTED', 'warning', l, `${what} is outside the supported ${this.subset} subset and was skipped`);
  }

  /** An error: the line cannot be read. */
  syntax(l: SourceLine, message: string): void {
    this.add('FLX_IMPORT_SYNTAX', 'error', l, message);
  }

  /** An error: the diagram kind is not one of the supported ones. */
  unknownKind(l: SourceLine, kind: string): void {
    this.add('FLX_IMPORT_UNKNOWN_KIND', 'error', l, `"${kind}" is not a supported Mermaid diagram kind`);
  }

  /** True when any error was raised. */
  get failed(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  private add(
    code: 'FLX_IMPORT_UNSUPPORTED' | 'FLX_IMPORT_SYNTAX' | 'FLX_IMPORT_UNKNOWN_KIND',
    severity: 'warning' | 'error',
    l: SourceLine,
    message: string,
  ): void {
    const source = { line: l.line, col: 1, endLine: l.line, endCol: l.text.length + 1, offset: l.offset, end: l.offset + l.text.length };
    this.items.push({ code, severity, message, path: '/', source });
  }
}

/** Hands out lower-case slugs, unique within one import, and remembers the slug of each source id. */
export class Slugs {
  private readonly used = new Set<string>();
  private readonly byKey = new Map<string, string>();

  /** The slug of `key` (the same each time), made from `text`. */
  slug(key: string, text: string = key): string {
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    const base =
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^[^a-z]+/, '')
        .replace(/-+$/, '')
        .slice(0, 32)
        .replace(/-+$/, '') || 'n';
    let slug = base;
    for (let n = 2; this.used.has(slug); n++) slug = `${base}-${n}`;
    this.used.add(slug);
    this.byKey.set(key, slug);
    return slug;
  }

  /** A fresh slug that no key maps to. */
  fresh(text: string): string {
    return this.slug(`\u0000${this.used.size}:${text}`, text);
  }
}

/** Mermaid label text as a plain string: quotes and backticks off, `<br>` a line break. */
export function plain(raw: string): string {
  const t = raw
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^`(.*)`$/s, '$1');
  return t.replace(/<br\s*\/?>/gi, '\n').trim();
}

/** What a parser needs besides its lines: where to report, where to get slugs, the screen id and title. */
export type ParseCtx = {
  readonly report: Report;
  readonly slugs: Slugs;
  readonly id: string;
  readonly title: string;
  /** Set when the diagram sits inside another file, so its diagnostics point into that file. */
  readonly at?: SourceOrigin | undefined;
};
