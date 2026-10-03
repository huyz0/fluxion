// The toolbar's host-supplied controls (FR-THM-004, FR-THM-008, FR-DOC-006): the theme switcher when the host offers themes, the Fonts
// button with its picker when it offers fonts, and the Details button with the document's metadata dialog. One node for the toolbar.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontPicker, type FontSources } from './font-picker.js';
import { MetadataDialog } from './metadata-dialog.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';
import { type ThemeChoice, ThemeSwitcher } from './theme-switcher.js';

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
};

/** `node` drawn in the editor's own box, outside the toolbar (whose box clips and stacks a dialog under the panels). */
const dialog = (from: HTMLElement | null, node: ReactNode): ReactNode => {
  const host = from?.closest('.fx-editor') ?? document.body;
  return createPortal(node, host);
};

/** The theme switcher, the Fonts button with its dialog and the Details button with its dialog. */
export function ToolbarExtras(props: ToolbarExtrasProps): ReactNode {
  const { store, execute, session, screenId, themes, fonts } = props;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const selection = useValue(session.selection.get);
  return (
    <>
      {themes === undefined ? null : <ThemeSwitcher store={store} execute={execute} themes={themes} screenId={screenId} />}
      {fonts === undefined ? null : (
        <button ref={button} type="button" className="fx-chrome-button" aria-haspopup="dialog" title="Fonts" onClick={() => setOpen(true)}>
          Fonts
        </button>
      )}
      <button
        ref={detailsButton}
        type="button"
        className="fx-chrome-button"
        aria-haspopup="dialog"
        aria-label="Document details"
        title="Document details"
        onClick={() => setDetails(true)}
      >
        Details
      </button>
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
