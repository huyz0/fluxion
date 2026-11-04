// The My shapes section of the library (FR-LIB-008, M18.35): save the selection under a name, insert a saved item
// with a click, remove one, and export or import the person's items as a `fluxion-my-shapes` file. The items and
// their storage are the host's (`MyShapes`); the section only calls back.
import { useValue } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import '../i18n.js';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { exportMyShapes, type MyShape, type MyShapes, type MyShapesResult, myShapeUnavailable, type ShapeAvailable } from './my-shapes.js';

/**
 * Props of {@link MyShapesSection}.
 *
 * @public
 */
export type MyShapesSectionProps = {
  /** The person's items. */
  readonly myShapes: MyShapes;
  /** Whether something is selected to save. */
  readonly canSave: boolean;
  /** Save the selection under `name`; why not, when nothing was saved. */
  readonly onSave: (name: string) => MyShapesResult<unknown>;
  /** Put `item` on the canvas. */
  readonly onInsert: (item: MyShape) => void;
  /** Hand the person the export file's text (a download). */
  readonly onExport: (text: string) => void;
  /** Tell the person something (a save, import or undo refused). */
  readonly notify?: ((message: string) => void) | undefined;
};

/** The name form shown while saving. */
function SaveForm(props: { readonly onDone: (name: string | undefined) => void }): ReactNode {
  const [name, setName] = useState('');
  return (
    <form
      className="fx-chrome-library-mine-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onDone(name.trim() === '' ? undefined : name);
      }}
    >
      <input
        type="text"
        className="fx-chrome-library-search"
        aria-label={t`Name of the saved shape`}
        value={name}
        // biome-ignore lint/a11y/noAutofocus: the form opens on the person's click, to type the name at once
        autoFocus
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onDone(undefined);
        }}
      />
      <button type="submit" className="fx-chrome-button" disabled={name.trim() === ''}>
        {t`Save`}
      </button>
    </form>
  );
}

/** The removed item, with a way back (FR-LIB-008: a remove is undone, not lost). */
function RemovedBar(props: { readonly item: MyShape; readonly onUndo: () => void }): ReactNode {
  return (
    <p className="fx-chrome-library-mine-undo" role="status">
      <span>{t`Removed ${props.item.name}.`}</span>
      <button type="button" className="fx-chrome-button" data-mine="undo" onClick={props.onUndo}>
        {t`Undo`}
      </button>
    </p>
  );
}

/** The items: a click inserts one, × removes it. */
function ItemList(props: {
  readonly items: readonly MyShape[];
  readonly available: ShapeAvailable;
  readonly onInsert: (item: MyShape) => void;
  readonly onRemove: (item: MyShape) => void;
}): ReactNode {
  return (
    <ul className="fx-chrome-library-mine-list" aria-label={t`My shapes`}>
      {props.items.map((item) => {
        // re-checked on every read: a stored item whose shapes are not available here is listed, marked, and not inserted
        const unavailable = myShapeUnavailable(item, props.available);
        return (
          <li key={item.id} className="fx-chrome-library-mine-item" data-my-shape={item.id} data-unavailable={unavailable === undefined ? undefined : ''}>
            <button
              type="button"
              className="fx-chrome-button fx-chrome-library-mine-insert"
              data-mine="insert"
              disabled={unavailable !== undefined}
              title={unavailable === undefined ? undefined : t`Unavailable: ${unavailable}`}
              onClick={() => props.onInsert(item)}
            >
              {unavailable === undefined ? item.name : t`${item.name} (unavailable)`}
            </button>
            <button type="button" className="fx-chrome-button" aria-label={t`Remove ${item.name} from My shapes`} onClick={() => props.onRemove(item)}>
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Export and import of a `fluxion-my-shapes` file. */
function FilesRow(props: { readonly myShapes: MyShapes; readonly onExport: (text: string) => void; readonly notify: (message: string) => void }): ReactNode {
  const { myShapes, onExport, notify } = props;
  const file = useRef<HTMLInputElement>(null);
  const items = useValue(myShapes.items);
  const imported = (text: string) => {
    const r = myShapes.importFile(text);
    if (!r.ok) notify(t`That file could not be imported: ${r.reason}.`);
  };
  return (
    <div className="fx-chrome-library-mine-files">
      <button type="button" className="fx-chrome-button" disabled={items.length === 0} onClick={() => onExport(exportMyShapes(myShapes.items()))}>
        {t`Export My shapes`}
      </button>
      <button type="button" className="fx-chrome-button" onClick={() => file.current?.click()}>
        {t`Import My shapes`}
      </button>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label={t`My shapes file to import`}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked === undefined) return;
          picked.text().then(imported, () => notify(t`That file could not be read.`));
        }}
      />
    </div>
  );
}

/**
 * The section.
 *
 * @public
 */
export function MyShapesSection(props: MyShapesSectionProps): ReactNode {
  const { myShapes, canSave, onSave, onInsert, onExport } = props;
  const notify = (message: string) => props.notify?.(message);
  const items = useValue(myShapes.items);
  const [naming, setNaming] = useState(false);
  // every removal, latest last: Undo puts back the latest, and the one before it is offered next (M18.130)
  const [removed, setRemoved] = useState<readonly MyShape[]>([]);
  const latest = removed.at(-1);
  const section = useRef<HTMLElement>(null);
  // where focus goes once the next render is on screen: the Save button after the form closes, Undo after a remove,
  // the restored item after an undo; never left on a control that is gone
  const focusNext = useRef<string | undefined>(undefined);
  useEffect(() => {
    const selector = focusNext.current;
    focusNext.current = undefined;
    if (selector === undefined) return;
    // the control may be gone or disabled: focus stays in the section, never on the page body
    const target = section.current?.querySelector<HTMLElement>(selector);
    if (target !== null && target !== undefined && !(target as HTMLButtonElement).disabled) target.focus();
    else section.current?.focus();
  });
  const heading = useId();
  return (
    <section ref={section} className="fx-chrome-library-mine" aria-labelledby={heading} tabIndex={-1}>
      <h3 id={heading} className="fx-chrome-heading">{t`My shapes`}</h3>
      {naming ? (
        <SaveForm
          onDone={(name) => {
            setNaming(false);
            focusNext.current = '[data-mine="save"]';
            const saved = name === undefined ? undefined : onSave(name);
            if (saved?.ok === false) notify(t`The selection could not be saved to My shapes: ${saved.reason}.`);
          }}
        />
      ) : (
        <button type="button" className="fx-chrome-button" data-mine="save" disabled={!canSave} onClick={() => setNaming(true)}>
          {t`Save selection to My shapes`}
        </button>
      )}
      <ItemList
        items={items}
        available={myShapes.available}
        onInsert={onInsert}
        onRemove={(item) => {
          myShapes.remove(item.id);
          setRemoved((now) => [...now, item]);
          focusNext.current = '[data-mine="undo"]';
        }}
      />
      {latest !== undefined && (
        <RemovedBar
          item={latest}
          onUndo={() => {
            // a refused put keeps the removal offered, to try again; nothing re-renders, so focus stays on the clicked
            // Undo (a pending focus here would jump later, on some unrelated render)
            if (!myShapes.put(latest)) return notify(t`${latest.name} could not be put back in My shapes.`);
            setRemoved((now) => now.filter((i) => i !== latest));
            focusNext.current = `[data-my-shape="${CSS.escape(latest.id)}"] [data-mine="insert"]`;
          }}
        />
      )}
      <FilesRow myShapes={myShapes} onExport={onExport} notify={notify} />
    </section>
  );
}
