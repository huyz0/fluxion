// The source view (FR-EDT-022, ADR-0032): CodeMirror over the shown screen's FluxScript. The author's edits are compiled after a pause and
// applied to the canvas as one undo step; a text with errors applies nothing and shows its diagnostics in the gutter and in a list. This file is
// the lazy chunk's root: the editor's initial chunk reaches it only through `loadSourceView` (a dynamic import).
// Not here yet (M12.48, M12.49): canvas to text regeneration, focus and dirty rules, the three-way merge.
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { CoreRegistries, Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import '../i18n.js';
import type { Execute } from '../pointer.js';
import { fluxScriptCompletion } from './completion.js';
import { completionCatalog } from './completion-catalog.js';
import { diagnosticsGutter, type ShownDiagnostic, setDiagnostics, shownDiagnostics } from './diagnostics-gutter.js';
import { fluxScriptLanguage } from './fluxscript-language.js';
import { createSourceSync, headerLength, type Scheduler, type SyncResult, sourceOf } from './source-sync.js';

/** Props of {@link SourceView}. */
export type SourceViewProps = {
  /** The open document. */
  readonly store: Store;
  /** The command runner: every apply is one `document.applyRecords`. */
  readonly execute: Execute;
  /** The registries the text is compiled against (shapes, layouts, themes). */
  readonly registries: CoreRegistries;
  /** The screen shown; its source is generated when this changes. */
  readonly screenId: RecordId | undefined;
  /** The timer of the debounce (the browser's by default); tests inject theirs. */
  readonly scheduler?: Scheduler;
  /** The quiet time before a compile, in ms (300 by default). */
  readonly delayMs?: number;
  /** Escape in the editor: the host puts the focus back where the view was reached from. */
  readonly onEscape?: () => void;
};

const HEADER_LINE = Decoration.line({ class: 'fx-source-header' });

/** The theme: the chrome's tokens, so the panel's light and dark modes and its forced colours carry over. */
const THEME = EditorView.theme({
  '&': { color: 'var(--ui-text)', backgroundColor: 'var(--ui-panel)', fontSize: '12px', height: 'clamp(200px, 50vh, 560px)' },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: '2px solid var(--ui-focus)', outlineOffset: '-2px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: 'var(--ui-text)' },
  '.cm-gutters': { backgroundColor: 'var(--ui-panel)', color: 'var(--ui-muted)', borderRight: '1px solid var(--ui-border)' },
  '.fx-source-header': { color: 'var(--ui-muted)', backgroundColor: 'var(--ui-bg)' },
  '.fx-key': { color: 'var(--ui-text)', fontWeight: '600' },
  '.fx-key-deferred': { color: 'var(--ui-muted)', fontStyle: 'italic' },
  '.fx-op': { color: 'var(--ui-accent)', fontWeight: '700' },
  '.fx-shape, .fx-pack': { color: 'var(--ui-accent)' },
  '.fx-source-error': { textDecoration: 'underline wavy #dc2626' },
  '.fx-source-warning': { textDecoration: 'underline wavy #b45309' },
  '.fx-source-marker': { display: 'inline-block', width: '1.2em', textAlign: 'center', fontWeight: '700', cursor: 'default' },
  '.fx-source-marker[data-severity="error"]': { color: '#dc2626' },
  '.fx-source-marker[data-severity="warning"]': { color: '#b45309' },
});

/** The extensions of an editor over a source whose first `editFrom` characters are the read-only header. */
function extensionsFor(props: SourceViewProps, editFrom: number, onDoc: (text: string) => void): readonly Extension[] {
  const { store, registries, screenId } = props;
  const catalog = completionCatalog({ shapeDefs: registries.shapeDefs, view: store, screen: () => screenId });
  return [
    lineNumbers(),
    fluxScriptLanguage(),
    fluxScriptCompletion(catalog),
    diagnosticsGutter,
    EditorView.lineWrapping,
    THEME,
    EditorView.contentAttributes.of({ 'aria-label': t`FluxScript source`, 'aria-multiline': 'true' }),
    // the header is read-only: a change that touches it is dropped
    EditorState.changeFilter.of((tr) => {
      let touches = false;
      tr.changes.iterChangedRanges((from) => {
        if (from < editFrom) touches = true;
      });
      return !touches;
    }),
    EditorView.decorations.of((view) => {
      const lines = [];
      for (let n = 1; n <= view.state.doc.lines && view.state.doc.line(n).to < editFrom; n++) lines.push(HEADER_LINE.range(view.state.doc.line(n).from));
      return Decoration.set(lines);
    }),
    // no text history without @codemirror/commands (not locked): the browser's undo would desynchronise the view, so Mod-z is not passed on
    keymap.of([
      { key: 'Escape', run: () => (props.onEscape === undefined ? false : (props.onEscape(), true)) },
      { key: 'Mod-z', run: () => true },
      { key: 'Mod-y', run: () => true },
      { key: 'Mod-Shift-z', run: () => true },
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onDoc(u.state.doc.toString());
    }),
  ];
}

/** A short line of what the last try came to. */
function statusText(result: SyncResult | undefined, errors: number): string {
  if (result === undefined) return '';
  if (result.status === 'invalid')
    return errors === 1 ? t`1 error: the canvas keeps its last good state.` : t`${errors} errors: the canvas keeps its last good state.`;
  if (result.status === 'refused') return t`The document refused the change: ${result.problem ?? ''}`;
  return result.status === 'applied' ? t`Applied to the canvas.` : t`Up to date.`;
}

/** The list of problems; each row jumps to its line. */
function ProblemList(props: { readonly items: readonly ShownDiagnostic[]; readonly onJump: (d: ShownDiagnostic) => void }): ReactNode {
  if (props.items.length === 0) return null;
  const label = { error: t`Error`, warning: t`Warning` };
  return (
    <ul className="fx-chrome-problems fx-source-problems" aria-label={t`Source problems`}>
      {props.items.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a list rebuilt whole by each compile
        <li key={i} className="fx-chrome-problem" data-severity={d.severity} data-code={d.code}>
          <span className="fx-chrome-problem-text">
            <strong>{label[d.severity]}:</strong> {d.line === undefined ? '' : t`Line ${d.line}: `}
            {d.message}
          </span>
          {d.from === undefined ? null : (
            <button type="button" className="fx-chrome-button" onClick={() => props.onJump(d)}>
              {t`Go to line`}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The source of the shown screen, editable. Regenerated when the screen changes (not when the canvas does, M12.48).
 *
 * @param props - the document, the commands and the screen
 * @returns the view
 */
export function SourceView(props: SourceViewProps): ReactNode {
  const { store, execute, registries, screenId, scheduler, delayMs } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [shown, setShown] = useState<readonly ShownDiagnostic[]>([]);
  const [result, setResult] = useState<SyncResult | undefined>();
  const text = useMemo(() => (screenId === undefined ? '' : sourceOf(store, registries, screenId)), [store, registries, screenId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is rebuilt for a screen (its text is generated again), not for every prop
  useEffect(() => {
    const parent = host.current;
    if (parent === null || screenId === undefined) return;
    let alive = true;
    const sync = createSourceSync({
      store,
      execute,
      registries,
      ...(scheduler === undefined ? {} : { scheduler }),
      ...(delayMs === undefined ? {} : { delayMs }),
      onResult: (r) => {
        const editor = view.current;
        if (!alive || editor === null) return;
        const list = shownDiagnostics(r.diagnostics, editor.state.doc.toString());
        editor.dispatch({ effects: setDiagnostics.of(list) });
        setShown(list);
        setResult(r);
      },
    });
    const editor = new EditorView({
      parent,
      state: EditorState.create({ doc: text, extensions: extensionsFor(latest.current, headerLength(text), sync.edit) }),
    });
    view.current = editor;
    setShown([]);
    setResult(undefined);
    return () => {
      // an edit still waiting belongs to the screen being left: apply it, then drop the view
      sync.flush();
      alive = false;
      editor.destroy();
      view.current = null;
    };
  }, [store, execute, registries, screenId, text, scheduler, delayMs]);

  const jump = (d: ShownDiagnostic): void => {
    const editor = view.current;
    if (editor === null || d.from === undefined) return;
    editor.dispatch({ selection: { anchor: d.from }, scrollIntoView: true });
    editor.focus();
  };
  const errors = shown.filter((d) => d.severity === 'error').length;
  return (
    <section className="fx-chrome-source" aria-label={t`Source view`} data-testid="source-view">
      {screenId === undefined ? <p className="fx-chrome-placeholder">{t`There is no screen to show the source of.`}</p> : null}
      <div ref={host} className="fx-chrome-source-host" />
      <p className="fx-chrome-source-status" role="status" data-status={result?.status}>
        {statusText(result, errors)}
      </p>
      <ProblemList items={shown} onJump={jump} />
    </section>
  );
}
