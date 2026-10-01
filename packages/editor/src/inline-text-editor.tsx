// The inline text editor (FR-TXT-003, ADR-0064, M7.12): the text of the element in `session.editing`
// edited in place, in a ProseMirror view laid over the element exactly where its label is drawn (the same
// box, style and content CSS, through the camera and the element's turn), so what is typed is what the
// screen shows. Esc, or focus leaving, commits: one `element.update` writing the text (and, for a `grow`
// shape, the height it needs) and one undo step. While it is open the element's own label is hidden.
import type { Store } from '@fluxion/core';
import { grownHeight, labelBox, type RenderRegistries, useValue } from '@fluxion/render';
import type { RecordId, RichTextDoc } from '@fluxion/schema';
import { LIGHT_THEME, toCssVars } from '@fluxion/theme';
import { EditorView } from 'prosemirror-view';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { pageToScreen } from './camera.js';
import { placements } from './overlay-geometry.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';
import { textElement } from './text-edit.js';
import { edited, textOf, textState } from './text-pm.js';

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
  return id === undefined ? null : <Editing key={id} {...props} id={id} />;
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

/** `text` written to the element `id` in one transaction, with the height a `grow` shape needs, as one undo step. */
function write(deps: Pick<InlineTextEditorProps, 'store' | 'registries' | 'execute'>, id: RecordId, text: RichTextDoc): void {
  const { store, registries, execute } = deps;
  const current = textElement(store, id);
  if (current === undefined) return;
  const h = current.kind === 'shape' ? grownHeight({ element: current, text, registries, theme: LIGHT_THEME }) : undefined;
  execute('element.update', { id, fields: { text, ...(h === undefined ? {} : { transform: { ...current.transform, h } }) } });
  store.history.seal();
}

/** The open editor of the element `id`. */
function Editing(props: InlineTextEditorProps & { readonly id: RecordId }): ReactNode {
  const { store, registries, session, execute, id } = props;
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
  useEffect(() => {
    const parent = host.current;
    const initial = textElement(store, id);
    if (parent === null || initial === undefined) return;
    let open = true;
    const close = (view: EditorView) => {
      if (!open) return;
      open = false;
      const state = view.state;
      view.destroy();
      session.editing.set(undefined);
      if (edited(state)) write({ store, registries, execute }, id, textOf(state));
    };
    const view = new EditorView(parent, {
      state: textState(initial.text),
      attributes: { class: 'fx-chrome-textroot' },
      handleKeyDown: (v, e) => {
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
  }, [store, registries, session, execute, id]);
  useEffect(() => (wrapper.current === null ? undefined : keepPointer(wrapper.current)), []);
  if (element === undefined || placed === undefined) return null;
  const label = labelBox(element, registries, LIGHT_THEME);
  const at = pageToScreen(camera, { x: placed.x, y: placed.y });
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
      <style>{`.fx-el[data-el-id="${CSS.escape(id)}"] .fx-label { visibility: hidden; }`}</style>
      <div className="fx-chrome-textedit-box" style={{ width: placed.w, height: placed.h, transform: `scale(${camera.z})` }}>
        <div ref={host} className="fx-label" style={label} />
      </div>
    </div>
  );
}
