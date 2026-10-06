// The image tool's picker (FR-EDT-003): the box the tool placed waits in the session while the picker
// offers the document's image assets, an image frame placeholder shape, and a button that imports an image from a file
// (FR-AST-001, M10.31) and places it at the box.

import type { Store } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
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
  /** Import image files and place them at the page point (the middle of the pending box): the picker's file button. */
  readonly onImport?: ((files: readonly File[], at: Vec2) => void) | undefined;
};

/** The picker, shown while the image tool's box waits for an image; Esc or Cancel adds nothing. */
export function ImagePicker(props: ImagePickerProps): ReactNode {
  const box = useValue(props.session.imagePick.get);
  // mounted only while a pick is pending: closed, it reads nothing, so edits never re-render it
  return box === undefined ? null : <Picker {...props} box={box} />;
}

/** The open picker for the pending `box`. */
function Picker(props: ImagePickerProps & { readonly box: Box }): ReactNode {
  const { store, session, execute, screenId, newId, box, onImport } = props;
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
    <div ref={dialog} className="fx-chrome-picker" role="dialog" aria-modal="true" aria-label={t`Choose an image`} onKeyDown={(e) => dialogKey(e, close)}>
      <h2 className="fx-chrome-heading">{t`Choose an image`}</h2>
      {assets.length === 0 ? <p className="fx-chrome-placeholder">{t`This document holds no images yet.`}</p> : null}
      {assets.map((a) => (
        <button key={a.id} type="button" className="fx-chrome-button" onClick={() => choose(imageMaker(a.id))}>
          {a.name}
        </button>
      ))}
      <button type="button" className="fx-chrome-button" onClick={() => choose(shapeMaker('basic:image-frame'))}>
        {t`Image placeholder`}
      </button>
      {onImport === undefined ? null : (
        <>
          <button type="button" className="fx-chrome-button" onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()}>
            {t`Import an image…`}
          </button>
          <input
            type="file"
            accept="image/*"
            multiple
            aria-hidden="true"
            tabIndex={-1}
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length === 0) return;
              close();
              onImport(files, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
            }}
          />
        </>
      )}
      <button type="button" className="fx-chrome-button" onClick={close}>
        {t`Cancel`}
      </button>
    </div>
  );
}
