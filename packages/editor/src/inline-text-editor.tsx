// The inline text editor (FR-TXT-003, ADR-0064, M7.12): the text of the element in `session.editing`
// edited in place, in a ProseMirror view laid over the element exactly where its label is drawn (the same
// box, style and content CSS, through the camera and the element's turn), so what is typed is what the
// screen shows. Esc, or focus leaving, commits: one `element.update` writing the text (and, for a `grow`
// shape, the height it needs) and one undo step. While it is open the element's own label is hidden.
import type { Store } from '@fluxion/core';
import { grownHeight, labelBox, type RenderRegistries, useValue } from '@fluxion/render';
import type { RecordId, RichTextDoc, ShapeElement, TextElement } from '@fluxion/schema';
import { LIGHT_THEME, toCssVars } from '@fluxion/theme';
import { t } from '@lingui/core/macro';
import { EditorView } from 'prosemirror-view';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { type Camera, pageToScreen } from './camera.js';
import { type Placed, placements } from './overlay-geometry.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';
import './i18n.js';
import { regionAfter, textElement } from './text-edit.js';
import { edited, movesListItem, textOf, textState } from './text-pm.js';

/** Props of {@link InlineTextEditor}. */
export type InlineTextEditorProps = {
  /** The document store. */
  readonly store: Store;
  /** Where shape definitions are looked up (the label's region, the height a grow shape needs). */
  readonly registries: RenderRegistries;
  /** The session: the element being edited, and the camera it is drawn through. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
};

/** The editor over the element being edited, mounted only while one is. */
export function InlineTextEditor(props: InlineTextEditorProps): ReactNode {
  const id = useValue(props.session.editing.get);
  const region = useValue(props.session.editingRegion.get);
  return id === undefined ? null : <Editing key={`${id}/${region ?? ''}`} {...props} id={id} region={region} />;
}

/** Stop the canvas's pointer input at `el`: a press in the text is the text's, not a tool's. */
function keepPointer(el: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation();
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick'];
  for (const t of types) el.addEventListener(t, stop);
  return () => {
    for (const t of types) el.removeEventListener(t, stop);
  };
}

/** The text the editor opens: a named region's (FR-SHP-007), else the element's. */
function textIn(element: ShapeElement | TextElement, region: string | undefined): RichTextDoc | undefined {
  return region === undefined ? element.text : element.kind === 'shape' ? element.texts?.[region] : undefined;
}

/**
 * `text` written to the element `id` in one transaction, with the height a `grow` shape needs, as one undo step; a named
 * region's text goes to its `texts` entry alone, the others and the height left as they are.
 */
function write(deps: Pick<InlineTextEditorProps, 'store' | 'registries' | 'execute'>, id: RecordId, text: RichTextDoc, region: string | undefined): void {
  const { store, registries, execute } = deps;
  const current = textElement(store, id);
  if (current === undefined) return;
  if (region !== undefined) {
    // only a shape has regions: the double-click names one only on a shape, whose other regions' texts are kept
    const texts = (current as Pick<ShapeElement, 'texts'>).texts;
    execute('element.update', { id, fields: { texts: { ...texts, [region]: text } } });
    store.history.seal();
    return;
  }
  const h = current.kind === 'shape' ? grownHeight({ element: current, text, registries, theme: LIGHT_THEME }) : undefined;
  execute('element.update', { id, fields: { text, ...(h === undefined ? {} : { transform: { ...current.transform, h } }) } });
  store.history.seal();
}

/**
 * What an in-place editor edits (an element's text or region, a table cell's, M19.43): the text it opens on, its accessible name,
 * what its closing does in the session, where a changed text is written, and where Tab and Shift+Tab (`back`) go.
 */
export type InPlaceText = {
  /** The text the editor opens on. */
  readonly text: RichTextDoc | undefined;
  /** The editor's accessible name. */
  readonly name: string;
  /** The editor closed: the session forgets what was being edited (before the text is written). */
  readonly closed: () => void;
  /** Writes the text typed, as one undo step; called only when it changed. */
  readonly write: (text: RichTextDoc) => void;
  /** What opens next once this text is committed, or false to leave Tab to the focus. */
  readonly next: (back: boolean) => (() => void) | false;
};

/**
 * Open the ProseMirror editor in `parent` on `it`; returns what closes it, which writes what was typed. Esc or focus leaving closes
 * it too; Tab and Shift+Tab commit and open what `it.next` names, unless they indent or outdent a list item.
 */
export function openInPlace(parent: HTMLElement, it: InPlaceText): () => void {
  let open = true;
  const close = (view: EditorView) => {
    if (!open) return;
    open = false;
    const state = view.state;
    view.destroy();
    it.closed();
    if (edited(state)) it.write(textOf(state));
  };
  const tabTo = (v: EditorView, e: KeyboardEvent): boolean => {
    if (e.altKey || e.ctrlKey || e.metaKey || movesListItem(v.state, e.shiftKey)) return false;
    const then = it.next(e.shiftKey);
    if (then === false) return false;
    e.preventDefault();
    close(v);
    then();
    return true;
  };
  const view = new EditorView(parent, {
    state: textState(it.text),
    attributes: { class: 'fx-chrome-textroot', role: 'textbox', 'aria-multiline': 'true', 'aria-label': it.name },
    handleKeyDown: (v, e) => {
      if (e.key === 'Tab') return tabTo(v, e);
      if (e.key !== 'Escape') return false;
      close(v);
      return true;
    },
  });
  const leave = (e: FocusEvent) => {
    if (!(e.relatedTarget instanceof Node && parent.contains(e.relatedTarget))) close(view);
  };
  parent.addEventListener('focusout', leave);
  view.focus();
  return () => {
    parent.removeEventListener('focusout', leave);
    close(view);
  };
}

/** Open the editor in `parent` on the text of `id` (its region `region`, when named); returns what closes it. */
function openEditor(parent: HTMLElement, ctx: InlineTextEditorProps & { readonly id: RecordId; readonly region: string | undefined }): () => void {
  const { store, registries, session, execute, id, region } = ctx;
  const initial = textElement(store, id);
  if (initial === undefined) return () => undefined;
  // Tab and Shift+Tab move to a shape's next and previous text region (FR-SHP-007, M19.17 r1 F1), committing this one; past the
  // last region Tab leaves the editor as before
  const defId = (initial as Partial<Pick<ShapeElement, 'defId'>>).defId;
  const def = defId === undefined ? undefined : registries.shapeDefs.get(defId);
  return openInPlace(parent, {
    text: textIn(initial, region),
    // the accessible name says which region is open (M19.17 r2 F1, cp3 F3)
    name: region === undefined ? t`Text` : t`Edit text: ${region}`,
    closed: () => {
      session.editingRegion.set(undefined);
      session.editing.set(undefined);
    },
    write: (text) => write({ store, registries, execute }, id, text, region),
    next: (back) => {
      const to = regionAfter(def, region, back);
      return to === false
        ? false
        : () => {
            session.editingRegion.set(to);
            session.editing.set(id);
          };
    },
  });
}

/** The open editor of the element `id`. */
function Editing(props: InlineTextEditorProps & { readonly id: RecordId; readonly region: string | undefined }): ReactNode {
  const { store, registries, session, execute, id, region } = props;
  const host = useRef<HTMLDivElement>(null);
  const camera = useValue(session.camera.get);
  const element = useValue(useMemo(() => store.query((view) => textElement(view, id)), [store, id]));
  const placed = useValue(useMemo(() => store.query((view) => placements(view, [id])[0]), [store, id]));
  const gone = element === undefined;
  // the element went (an undo, a delete elsewhere): nothing left to write to
  useEffect(() => {
    if (gone) session.editing.set(undefined);
  }, [gone, session]);
  useEffect(
    () => (host.current === null ? undefined : openEditor(host.current, { store, registries, session, execute, id, region })),
    [store, registries, session, execute, id, region],
  );
  if (element === undefined || placed === undefined) return null;
  const label = labelBox(element, registries, LIGHT_THEME, region);
  // only the label being edited hides: a named region's own, or the first's (the others stay drawn)
  const which = region === undefined ? '.fx-label:not(.fx-region)' : `.fx-region[data-region="${CSS.escape(region)}"]`;
  return (
    <InPlaceFrame testId="text-editor" camera={camera} placed={placed} hide={`.fx-el[data-el-id="${CSS.escape(id)}"] ${which}`}>
      <div ref={host} className="fx-label" style={label} />
    </InPlaceFrame>
  );
}

/**
 * The frame an in-place editor sits in: the element's placed box through the camera and its turn, the label `hide` names hidden
 * while it is open, and the canvas's pointer input stopped at it.
 */
export function InPlaceFrame(props: {
  readonly testId: string;
  readonly camera: Camera;
  readonly placed: Placed;
  readonly hide: string;
  readonly children: ReactNode;
}): ReactNode {
  const { camera, placed } = props;
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => (wrapper.current === null ? undefined : keepPointer(wrapper.current)), []);
  const at = pageToScreen(camera, { x: placed.x, y: placed.y });
  const hidden = `${props.hide} { visibility: hidden; }`;
  return (
    <div
      ref={wrapper}
      className="fx-chrome-textedit"
      data-testid={props.testId}
      style={{
        left: at.x,
        top: at.y,
        width: placed.w * camera.z,
        height: placed.h * camera.z,
        transform: `rotate(${placed.rot}deg)`,
        ...toCssVars(LIGHT_THEME),
      }}
    >
      <style>{hidden}</style>
      <div className="fx-chrome-textedit-box" style={{ width: placed.w, height: placed.h, transform: `scale(${camera.z})` }}>
        {props.children}
      </div>
    </div>
  );
}
