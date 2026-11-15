// The inline text editor (FR-TXT-003, ADR-0064, M7.12): the text of the element in `session.editing`
// edited in place, in a ProseMirror view laid over the element exactly where its label is drawn (the same
// box, style and content CSS, through the camera and the element's turn), so what is typed is what the
// screen shows. Esc, or focus leaving, commits: one `element.update` writing the text (and, for a `grow`
// shape, the height it needs) and one undo step. While it is open the element's own label is hidden.
import type { Store } from '@fluxion/core';
import { grownHeight, labelBox, type RenderRegistries, useValue } from '@fluxion/render';
import type { RecordId, RichTextDoc, ShapeElement, TextElement } from '@fluxion/schema';
import { LIGHT_THEME, toCssVars } from '@fluxion/theme';
import { EditorView } from 'prosemirror-view';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { pageToScreen } from './camera.js';
import { placements } from './overlay-geometry.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';
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
 * Open the ProseMirror editor in `parent` on the text of `id` (its region `region`, when named); returns what closes it, which
 * writes what was typed. Esc or focus leaving closes it too.
 */
function openEditor(parent: HTMLElement, ctx: InlineTextEditorProps & { readonly id: RecordId; readonly region: string | undefined }): () => void {
  const { store, registries, session, execute, id, region } = ctx;
  const initial = textElement(store, id);
  if (initial === undefined) return () => undefined;
  let open = true;
  const close = (view: EditorView) => {
    if (!open) return;
    open = false;
    const state = view.state;
    view.destroy();
    session.editingRegion.set(undefined);
    session.editing.set(undefined);
    if (edited(state)) write({ store, registries, execute }, id, textOf(state), region);
  };
  // Tab and Shift+Tab move to a shape's next and previous text region (FR-SHP-007, M19.17 r1 F1), committing this one, unless
  // they indent or outdent a list item; past the last region Tab leaves the editor as before
  const defId = (initial as Partial<Pick<ShapeElement, 'defId'>>).defId;
  const def = defId === undefined ? undefined : registries.shapeDefs.get(defId);
  const tabTo = (v: EditorView, e: KeyboardEvent): boolean => {
    if (e.altKey || e.ctrlKey || e.metaKey || movesListItem(v.state, e.shiftKey)) return false;
    const to = regionAfter(def, region, e.shiftKey);
    if (to === false) return false;
    e.preventDefault();
    close(v);
    session.editingRegion.set(to);
    session.editing.set(id);
    return true;
  };
  const view = new EditorView(parent, {
    state: textState(textIn(initial, region)),
    attributes: { class: 'fx-chrome-textroot', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Text' },
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

/** The open editor of the element `id`. */
function Editing(props: InlineTextEditorProps & { readonly id: RecordId; readonly region: string | undefined }): ReactNode {
  const { store, registries, session, execute, id, region } = props;
  const host = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
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
  useEffect(() => (wrapper.current === null ? undefined : keepPointer(wrapper.current)), []);
  if (element === undefined || placed === undefined) return null;
  const label = labelBox(element, registries, LIGHT_THEME, region);
  const at = pageToScreen(camera, { x: placed.x, y: placed.y });
  // only the label being edited hides: a named region's own, or the first's (the others stay drawn)
  const which = region === undefined ? '.fx-label:not(.fx-region)' : `.fx-region[data-region="${CSS.escape(region)}"]`;
  const hideLabel = `.fx-el[data-el-id="${CSS.escape(id)}"] ${which} { visibility: hidden; }`;
  return (
    <div
      ref={wrapper}
      className="fx-chrome-textedit"
      data-testid="text-editor"
      style={{
        left: at.x,
        top: at.y,
        width: placed.w * camera.z,
        height: placed.h * camera.z,
        transform: `rotate(${placed.rot}deg)`,
        ...toCssVars(LIGHT_THEME),
      }}
    >
      <style>{hideLabel}</style>
      <div className="fx-chrome-textedit-box" style={{ width: placed.w, height: placed.h, transform: `scale(${camera.z})` }}>
        <div ref={host} className="fx-label" style={label} />
      </div>
    </div>
  );
}
