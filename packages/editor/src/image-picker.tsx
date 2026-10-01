// The image tool's picker (FR-EDT-003): the box the tool placed waits in the session while the picker
// offers the document's image assets, and an image frame placeholder shape. Importing images from
// files arrives with the file work (FR-AST-001); until then only what the document holds is offered.
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { createElement, type ElementMaker, imageAssets, imageMaker, shapeMaker } from './create-tool.js';
import { buttonsOf, dialogKey } from './dialog-keys.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

/** Props of {@link ImagePicker}. */
export type ImagePickerProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose pending image box it serves. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
  /** The screen the image is added to. */
  readonly screenId: RecordId | undefined;
  /** A fresh record id. */
  newId(): RecordId;
};

/** The picker, shown while the image tool's box waits for an image; Esc or Cancel adds nothing. */
export function ImagePicker(props: ImagePickerProps): ReactNode {
  const box = useValue(props.session.imagePick.get);
  // mounted only while a pick is pending: closed, it reads nothing, so edits never re-render it
  return box === undefined ? null : <Picker {...props} box={box} />;
}

/** The open picker for the pending `box`. */
function Picker(props: ImagePickerProps & { readonly box: Box }): ReactNode {
  const { store, session, execute, screenId, newId, box } = props;
  const assets = useValue(useMemo(() => store.query(imageAssets), [store]));
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dialog.current) buttonsOf(dialog.current)[0]?.focus();
  }, []);
  const close = () => session.imagePick.set(undefined);
  const choose = (make: ElementMaker) => {
    close();
    createElement({ view: store, screen: screenId, newId, execute, seal: () => store.history.seal(), session }, box, make);
  };
  return (
    <div ref={dialog} className="fx-chrome-picker" role="dialog" aria-modal="true" aria-label="Choose an image" onKeyDown={(e) => dialogKey(e, close)}>
      <h2 className="fx-chrome-heading">Choose an image</h2>
      {assets.length === 0 ? <p className="fx-chrome-placeholder">This document holds no images yet.</p> : null}
      {assets.map((a) => (
        <button key={a.id} type="button" className="fx-chrome-button" onClick={() => choose(imageMaker(a.id))}>
          {a.name}
        </button>
      ))}
      <button type="button" className="fx-chrome-button" onClick={() => choose(shapeMaker('basic:image-frame'))}>
        Image placeholder
      </button>
      <button type="button" className="fx-chrome-button" onClick={close}>
        Cancel
      </button>
    </div>
  );
}
