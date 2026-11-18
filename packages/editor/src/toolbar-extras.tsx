// The toolbar's host-supplied controls (FR-THM-004, FR-THM-008, FR-DOC-006): the theme switcher when the host offers themes, the Fonts
// button with its picker when it offers fonts, and the Details button with the document's metadata dialog. One node for the toolbar.

import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AssetDialog } from './asset-dialog.js';
import type { AssetStore } from './asset-store.js';
import { FontPicker, type FontSources } from './font-picker.js';
import { MetadataDialog } from './metadata-dialog.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';
import type { ThemeEditorProps } from './theme-editor/theme-editor.js';
import { type ThemeChoice, ThemeSwitcher } from './theme-switcher.js';

/** Load the theme editor's chunk (M20.11): the initial chunk holds only its button. */
export const loadThemeEditor = async (): Promise<{ default: ComponentType<ThemeEditorProps> }> => ({
  default: (await import('./theme-editor/theme-editor.js')).ThemeEditor,
});

const ThemeEditor = lazy(loadThemeEditor);

/** Props of {@link ToolbarExtras}. */
export type ToolbarExtrasProps = {
  readonly store: Store;
  readonly execute: Execute;
  readonly session: Session;
  /** The open screen. */
  readonly screenId: RecordId | undefined;
  /** The themes on offer (none: no theme switcher). */
  readonly themes: readonly ThemeChoice[] | undefined;
  /** The font sources (none: no Fonts button). */
  readonly fonts: FontSources | undefined;
  /** The bytes of the assets the editor holds (the asset manager's Replace puts the new bytes here). */
  readonly assets: AssetStore;
};

/** `node` drawn in the editor's own box, outside the toolbar (whose box clips and stacks a dialog under the panels). */
const dialog = (from: HTMLElement | null, node: ReactNode): ReactNode => {
  const host = from?.closest('.fx-editor') ?? document.body;
  return createPortal(node, host);
};

/** The Assets button with the asset manager's dialog. */
function AssetsControl(props: { readonly store: Store; readonly execute: Execute; readonly assets: AssetStore }): ReactNode {
  const [managing, setManaging] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="fx-chrome-button"
        aria-haspopup="dialog"
        aria-label={t`Assets`}
        title={t`Assets`}
        onClick={() => setManaging(true)}
      >
        {t`Assets`}
      </button>
      {managing
        ? dialog(
            button.current,
            <AssetDialog
              store={props.store}
              execute={props.execute}
              assets={props.assets}
              onClose={() => {
                setManaging(false);
                button.current?.focus();
              }}
            />,
          )
        : null}
    </>
  );
}

/** The Edit theme button with the theme editor beside the canvas (FR-THM-007). */
function ThemeEditorControl(props: { readonly store: Store; readonly execute: Execute; readonly screenId: RecordId | undefined }): ReactNode {
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // focus returns to the button once the editor has unmounted: focusing it in `close` lost to the editor's own mount focus when Esc
  // came before that effect ran, and the input it focused then left with the dialog (ci 44230337698)
  useEffect(() => {
    if (wasEditing.current && !editing) button.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const close = () => setEditing(false);
  return (
    <>
      <button ref={button} type="button" className="fx-chrome-button" aria-haspopup="dialog" aria-expanded={editing} onClick={() => setEditing((on) => !on)}>
        {t`Edit theme`}
      </button>
      {editing
        ? dialog(
            button.current,
            <Suspense
              fallback={
                <p role="status" className="fx-chrome-picker fx-chrome-theme-editor">
                  {t`Loading the theme editor…`}
                </p>
              }
            >
              <ThemeEditor store={props.store} execute={props.execute} screenId={props.screenId} onClose={close} />
            </Suspense>,
          )
        : null}
    </>
  );
}

/** The theme switcher, the Fonts button with its dialog and the Details button with its dialog. */
export function ToolbarExtras(props: ToolbarExtrasProps): ReactNode {
  const { store, execute, session, screenId, themes, fonts, assets } = props;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const selection = useValue(session.selection.get);
  return (
    <>
      {themes === undefined ? null : <ThemeSwitcher store={store} execute={execute} themes={themes} screenId={screenId} />}
      {themes === undefined ? null : <ThemeEditorControl store={store} execute={execute} screenId={screenId} />}
      {fonts === undefined ? null : (
        <button ref={button} type="button" className="fx-chrome-button" aria-haspopup="dialog" title={t`Fonts`} onClick={() => setOpen(true)}>
          {t`Fonts`}
        </button>
      )}
      <button
        ref={detailsButton}
        type="button"
        className="fx-chrome-button"
        aria-haspopup="dialog"
        aria-label={t`Document details`}
        title={t`Document details`}
        onClick={() => setDetails(true)}
      >
        {t`Details`}
      </button>
      <AssetsControl store={store} execute={execute} assets={assets} />
      {details
        ? dialog(
            detailsButton.current,
            <MetadataDialog
              store={store}
              execute={execute}
              onClose={() => {
                setDetails(false);
                detailsButton.current?.focus();
              }}
            />,
          )
        : null}
      {open && fonts !== undefined
        ? dialog(
            button.current,
            <FontPicker
              store={store}
              execute={execute}
              selection={selection}
              sources={fonts}
              onClose={() => {
                setOpen(false);
                // focus goes back to what opened the dialog
                button.current?.focus();
              }}
            />,
          )
        : null}
    </>
  );
}
