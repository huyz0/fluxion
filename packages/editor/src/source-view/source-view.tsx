// The source view (FR-EDT-022, ADR-0032): CodeMirror over the shown screen's FluxScript. The author's edits are compiled after a pause and
// applied to the canvas as one undo step; a text with errors applies nothing and shows its diagnostics in the gutter and in a list. This file is
// the lazy chunk's root: the editor's initial chunk reaches it only through `loadSourceView` (a dynamic import).
// A canvas change regenerates the text only while the view is clean and not focused; otherwise a banner offers the reload (M12.48, ADR-0032).
// An apply is the three-way merge of ADR-0032 (merge.ts): what the canvas changed and the text did not stays, a conflict is named in the status line,
// and ids that changed (a renamed slug) are told to the host (`onRemap`). The text has CodeMirror's own history (M12.59): Mod-z and Mod-Shift-z act on
// the text only, never on the document (ADR-0014's undo is the toolbar's and the canvas's). A regeneration is one entry of it, so a Reload can be undone;
// one that rewrites the header is not (the header is read-only, so no undo may touch it) and starts the history over.
import { history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { Annotation, Compartment, EditorState, type Extension, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { CoreRegistries, Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import '../i18n.js';
import type { Execute } from '../pointer.js';
import { fluxScriptCompletion } from './completion.js';
import { completionCatalog } from './completion-catalog.js';
import { diagnosticsGutter, type ShownDiagnostic, setDiagnostics, shownDiagnostics } from './diagnostics-gutter.js';
import { fluxScriptLanguage } from './fluxscript-language.js';
import { statusText } from './source-status.js';
import {
  createSourceController,
  cursorAnchor,
  cursorIn,
  headerLength,
  type Scheduler,
  type SourceController,
  type SyncResult,
  sourceOf,
} from './source-sync.js';

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
  /** An apply changed ids (a renamed slug, a record made by hand): the host moves the selection and the shown screen to the new ids. */
  readonly onRemap?: (remap: ReadonlyMap<RecordId, RecordId>) => void;
};

/** Marks the transaction of a regeneration: it is not the author's edit, so it must not schedule an apply (and cannot loop). */
const REGENERATED = Annotation.define<boolean>();

/** The text history lives in a compartment so a regeneration of the header can drop it and start a new one. */
const HISTORY = new Compartment();

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
function extensionsFor(
  props: SourceViewProps,
  editFrom: () => number,
  controller: () => SourceController,
  inBanner: (to: EventTarget | null) => boolean,
): readonly Extension[] {
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
    // the header is read-only: a change that touches it is dropped (a regeneration may rewrite it: the canvas changed the title or the theme)
    EditorState.changeFilter.of((tr) => {
      if (tr.annotation(REGENERATED) === true) return true;
      let touches = false;
      tr.changes.iterChangedRanges((from) => {
        if (from < editFrom()) touches = true;
      });
      return !touches;
    }),
    EditorView.decorations.of((view) => {
      const lines = [];
      for (let n = 1; n <= view.state.doc.lines && view.state.doc.line(n).to < editFrom(); n++) lines.push(HEADER_LINE.range(view.state.doc.line(n).from));
      return Decoration.set(lines);
    }),
    EditorView.domEventHandlers({
      focus: () => void controller().focus(),
      blur: (e) => void controller().blur({ toBanner: inBanner(e.relatedTarget) }),
      // an IME composition holds the apply back (`composing` below); its end schedules the text that waited
      compositionend: () => void controller().resume(),
    }),
    HISTORY.of(history()),
    // Mod-z, Mod-Shift-z and Mod-y are the text's own history (the browser's native undo would desynchronise the view); the window's key dispatcher
    // leaves a key typed into the contenteditable alone (`isEditable`), so the document is not undone by the same press
    keymap.of([{ key: 'Escape', run: () => (props.onEscape === undefined ? false : (props.onEscape(), true)) }, ...historyKeymap]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(REGENERATED) === true)) controller().edit(u.state.doc.toString());
    }),
  ];
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

/** Replace the editable text of `editor` by `next` in one change that is not the author's; `editFrom` is where the editable part started. */
function regenerate(editor: EditorView, next: string, editFrom: number): void {
  const old = editor.state.doc.toString();
  const from = headerLength(next);
  // the header is kept as it is unless the canvas changed it; then the whole text is replaced
  const start = from === editFrom && old.slice(0, editFrom) === next.slice(0, from) ? editFrom : 0;
  const cursor = cursorIn(next, cursorAnchor(old, editor.state.selection.main.head), from);
  // a change of the header cannot be undone (the filter would refuse the header's part): it is not recorded, and the history ends with the old text
  const header = start === 0;
  editor.dispatch({
    changes: { from: start, to: old.length, insert: next.slice(start) },
    selection: { anchor: cursor },
    effects: [setDiagnostics.of([]), ...(header ? [HISTORY.reconfigure([])] : [])],
    // a Reload is its own entry, apart from the typing around it
    annotations: header ? [REGENERATED.of(true), Transaction.addToHistory.of(false)] : [REGENERATED.of(true), isolateHistory.of('full')],
  });
  if (header) editor.dispatch({ effects: HISTORY.reconfigure(history()) });
}

/** The banner of a canvas that changed under a view that is focused or dirty. It follows the editor in the tab order. */
function CanvasBanner(props: {
  readonly shown: boolean;
  readonly box: RefObject<HTMLDivElement | null>;
  readonly onReload: () => void;
  readonly onLeave: (to: EventTarget | null) => void;
}): ReactNode {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only listens to the focus leaving its button; the live region itself is not interactive
    <div ref={props.box} className="fx-chrome-source-banner" role="status" onBlur={(e) => props.onLeave(e.relatedTarget)}>
      {props.shown ? (
        <>
          <span>{t`Canvas changed — reload`}</span>
          {/* the mouse down must not take the focus from the editor: a blur would apply the waiting text before the author chose */}
          <button type="button" className="fx-chrome-button" onMouseDown={(e) => e.preventDefault()} onClick={props.onReload}>
            {t`Reload`}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** What {@link mountEditor} needs of the component. */
type MountContext = {
  readonly parent: HTMLElement;
  readonly props: SourceViewProps;
  readonly screenId: RecordId;
  readonly text: string;
  readonly view: { current: EditorView | null };
  readonly control: { current: SourceController | null };
  /** The result of a waiting text dropped because its screen was deleted: the next mount shows it once (the status of the view that left would be lost). */
  readonly notice: { current: SyncResult | undefined };
  /** Whether the focus went to the banner. */
  readonly inBanner: (to: EventTarget | null) => boolean;
  readonly set: {
    readonly setShown: (list: readonly ShownDiagnostic[]) => void;
    readonly setResult: (result: SyncResult | undefined) => void;
    readonly setCanvasChanged: (show: boolean) => void;
  };
};

/** Build the editor and its controller for one screen; returns the cleanup (it applies a waiting edit, which belongs to the screen being left). */
function mountEditor(ctx: MountContext): () => void {
  const { parent, props, screenId, text, view, control, set, notice } = ctx;
  const { store, execute, registries, scheduler, delayMs } = props;
  let alive = true;
  let editFrom = headerLength(text);
  const live = (): EditorView | null => (alive ? view.current : null);
  const controller = createSourceController({
    store,
    execute,
    registries,
    screen: screenId,
    initial: text,
    composing: () => view.current?.composing === true,
    ...(scheduler === undefined ? {} : { scheduler }),
    ...(delayMs === undefined ? {} : { delayMs }),
    onRemap: (remap) => props.onRemap?.(remap),
    port: {
      text: () => view.current?.state.doc.toString() ?? '',
      replace: (next) => {
        const editor = live();
        if (editor === null) return;
        // the new boundary first: the decorations and the filter of the dispatch itself read it
        const old = editFrom;
        editFrom = headerLength(next);
        regenerate(editor, next, old);
        set.setShown([]);
      },
      banner: (show) => {
        if (alive) set.setCanvasChanged(show);
      },
      result: (r) => {
        const editor = live();
        if (editor === null) return;
        if (r?.status === 'gone') notice.current = r;
        const list = r === undefined ? [] : shownDiagnostics(r.diagnostics, editor.state.doc.toString());
        editor.dispatch({ effects: setDiagnostics.of(list) });
        set.setShown(list);
        set.setResult(r);
      },
    },
  });
  control.current = controller;
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: extensionsFor(
        props,
        () => editFrom,
        () => controller,
        ctx.inBanner,
      ),
    }),
  });
  view.current = editor;
  set.setShown([]);
  set.setResult(notice.current);
  notice.current = undefined;
  set.setCanvasChanged(false);
  return () => {
    controller.flush();
    controller.dispose();
    alive = false;
    editor.destroy();
    view.current = null;
    control.current = null;
  };
}

/**
 * The source of the shown screen, editable. Regenerated when the screen changes, and when the canvas does while the view is clean and not focused.
 *
 * @param props - the document, the commands and the screen
 * @returns the view
 */
export function SourceView(props: SourceViewProps): ReactNode {
  const { store, execute, registries, screenId, scheduler, delayMs } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const control = useRef<SourceController | null>(null);
  const notice = useRef<SyncResult | undefined>(undefined);
  const banner = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [shown, setShown] = useState<readonly ShownDiagnostic[]>([]);
  const [result, setResult] = useState<SyncResult | undefined>();
  const [canvasChanged, setCanvasChanged] = useState(false);
  const text = useMemo(() => (screenId === undefined ? '' : sourceOf(store, registries, screenId)), [store, registries, screenId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is rebuilt for a screen (its text is generated again), not for every prop
  useEffect(() => {
    const parent = host.current;
    if (parent === null || screenId === undefined) return;
    return mountEditor({ parent, props: latest.current, screenId, text, view, control, notice, inBanner, set: { setShown, setResult, setCanvasChanged } });
  }, [store, execute, registries, screenId, text, scheduler, delayMs]);

  const inBanner = (to: EventTarget | null): boolean => to instanceof Node && banner.current?.contains(to) === true;
  // the focus left the banner for somewhere outside the view: now the waiting text is applied. For the editor or the banner itself nothing happens.
  const leaveBanner = (to: EventTarget | null): void => {
    if (!inBanner(to) && !(to instanceof Node && host.current?.contains(to))) control.current?.blur();
  };
  // the editor takes the focus back first (the button is about to go), then the text is replaced
  const reload = (): void => {
    view.current?.focus();
    control.current?.reload();
  };
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
      <CanvasBanner shown={canvasChanged} box={banner} onReload={reload} onLeave={leaveBanner} />
      <p className="fx-chrome-source-status" role="status" data-status={result?.status}>
        {statusText(result, errors)}
      </p>
      <ProblemList items={shown} onJump={jump} />
    </section>
  );
}
