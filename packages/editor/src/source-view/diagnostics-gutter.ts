// Diagnostics in the source view (FR-EDT-022, ADR-0032): a gutter marker on each line a compile diagnostic points at, an underline on its range,
// and the list's rows. Built on `@codemirror/view` alone (the lint package is not in the lockfile). Lazy chunk.
import { type Extension, RangeSet, StateEffect, type StateEffectType, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { DslDiagnostic } from '@fluxion/dsl';

/** One problem as the view shows it. */
export type ShownDiagnostic = {
  /** The compile diagnostic's code. */
  readonly code: string;
  /** `error` blocks the apply; `warning` does not. */
  readonly severity: 'error' | 'warning';
  /** The message. */
  readonly message: string;
  /** 0-based start offset in the text, when the diagnostic has a place there. */
  readonly from?: number;
  /** 0-based end offset. */
  readonly to?: number;
  /** 1-based line of `from`. */
  readonly line?: number;
};

/** The diagnostics worth showing: errors and warnings (not notes), in source order, ranges kept inside `length`. */
export function shownDiagnostics(diagnostics: readonly DslDiagnostic[], text: string): ShownDiagnostic[] {
  const lineOf = (offset: number): number => text.slice(0, offset).split('\n').length;
  return diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'warning')
    .map((d): ShownDiagnostic => {
      const base = { code: d.code, severity: d.severity as 'error' | 'warning', message: d.message };
      if (d.source === undefined) return base;
      const from = Math.min(d.source.offset, text.length);
      const to = Math.max(from, Math.min(d.source.end, text.length));
      return { ...base, from, to, line: lineOf(from) };
    })
    .sort((a, b) => (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY));
}

/** The gutter's mark of one line. */
class Marker extends GutterMarker {
  readonly severity: 'error' | 'warning' | 'none';
  readonly messages: string;
  constructor(severity: 'error' | 'warning' | 'none', messages: string) {
    super();
    this.severity = severity;
    this.messages = messages;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof Marker && other.severity === this.severity && other.messages === this.messages;
  }
  override toDOM(): Node {
    const dot = document.createElement('span');
    dot.className = 'fx-source-marker';
    dot.dataset['severity'] = this.severity;
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', this.messages);
    dot.title = this.messages;
    dot.textContent = { error: '!', warning: '?', none: '\u00a0' }[this.severity];
    return dot;
  }
}

type Field = { readonly markers: RangeSet<GutterMarker>; readonly marks: DecorationSet };

const EMPTY: Field = { markers: RangeSet.empty, marks: Decoration.none };

/** Replace the shown diagnostics (the text they were computed from is the view's current one). */
export const setDiagnostics: StateEffectType<readonly ShownDiagnostic[]> = StateEffect.define<readonly ShownDiagnostic[]>();

const MARK = { error: Decoration.mark({ class: 'fx-source-error' }), warning: Decoration.mark({ class: 'fx-source-warning' }) };

/** The marker of each line and the underline of each range. */
function build(state: EditorView['state'], list: readonly ShownDiagnostic[]): Field {
  const perLine = new Map<number, ShownDiagnostic[]>();
  for (const d of list) {
    if (d.from === undefined) continue;
    const at = state.doc.lineAt(d.from).from;
    perLine.set(at, [...(perLine.get(at) ?? []), d]);
  }
  const markers = [...perLine]
    .sort(([a], [b]) => a - b)
    .map(([at, ds]) => {
      const severity = ds.some((d) => d.severity === 'error') ? 'error' : 'warning';
      return new Marker(severity, ds.map((d) => d.message).join('\n')).range(at);
    });
  const marks = list
    .filter((d) => d.from !== undefined && d.to !== undefined && d.to > d.from)
    .sort((a, b) => (a.from as number) - (b.from as number))
    .map((d) => MARK[d.severity].range(d.from as number, d.to as number));
  return { markers: RangeSet.of(markers, true), marks: Decoration.set(marks, true) };
}

const field = StateField.define<Field>({
  create: () => EMPTY,
  update(value, tr) {
    const effect = tr.effects.find((e) => e.is(setDiagnostics));
    if (effect !== undefined) return build(tr.state, effect.value as readonly ShownDiagnostic[]);
    // between two compiles the marks follow the text the author is typing
    return tr.docChanged ? { markers: value.markers.map(tr.changes), marks: value.marks.map(tr.changes) } : value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.marks),
    gutter({ class: 'fx-source-gutter', markers: (view) => view.state.field(f).markers, initialSpacer: () => new Marker('none', '') }),
  ],
});

/** The gutter markers and underlines; drive it with the {@link setDiagnostics} effect. */
export const diagnosticsGutter: Extension = field;
