// The asset manager dialog (FR-AST-005, M10.16): every asset of the document with its size and its share of the file, Replace for an image
// (a new file through the same import as a drop, the record keeps its id so every element that shows it shows the new picture), Remove for
// one nothing uses, and "Remove unused" for all of them at once, in one undo step. Esc or Close ends it.

import type { Store } from '@fluxion/core';
import { type ImageCodec, importImage, sha256Hex } from '@fluxion/format';
import type { RecordId } from '@fluxion/schema';
import { plural, t } from '@lingui/core/macro';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type AssetRow, assetRows, formatBytes, unusedAssetIds } from './asset-manager.js';
import type { AssetStore } from './asset-store.js';
import { dialogKey } from './dialog-keys.js';
import { browserImageCodec } from './image-codec.js';
import type { Execute } from './pointer.js';

/**
 * Props of {@link AssetDialog}.
 *
 * @public
 */
export type AssetDialogProps = {
  /** The document store. */
  readonly store: Store;
  /** Runs commands. */
  readonly execute: Execute;
  /** The bytes of the assets the editor holds (a replaced file's bytes go here). */
  readonly assets: AssetStore;
  /** The image codec a replacement is imported with (default the browser's). */
  readonly codec?: ImageCodec;
  /** Close the dialog. */
  readonly onClose: () => void;
};

/** `bytes` as a `data:` URL of media type `mime`. */
const dataUrlOf = (bytes: Uint8Array, mime: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes.slice().buffer], { type: mime }));
  });

/**
 * Replace the picture of asset `row` with `file`: imported like a drop, the bytes held under their new hash, then the record changed to it. The
 * bytes are in place before the record names them, and the hash picks them, so the picture shown always belongs to the record's hash: two
 * replaces that overlap leave the last one to finish, whole, and an undo shows the old bytes again.
 */
async function replace(props: AssetDialogProps, row: AssetRow, file: File): Promise<string | undefined> {
  const imported = await importImage(new Uint8Array(await file.arrayBuffer()), props.codec ?? browserImageCodec);
  if (!imported.ok) return imported.error.message;
  const { bytes, mime, width, height } = imported.value;
  const hash = sha256Hex(bytes);
  props.assets.put(row.id as RecordId, hash, await dataUrlOf(bytes, mime));
  const done = props.execute('asset.update', { id: row.id, fields: { hash, mime, size: bytes.length, w: width ?? null, h: height ?? null } });
  return done.ok ? undefined : done.error.message;
}

/** One asset's row: name, type, size and share, whether it is used, and its Replace and Remove controls. */
function AssetItem(props: { readonly row: AssetRow; readonly onReplace: (file: File) => void; readonly onRemove: () => void }): ReactNode {
  const { row, onReplace, onRemove } = props;
  return (
    <li data-asset={row.id}>
      <span className="fx-chrome-assetname">{row.name}</span>{' '}
      <span>
        {row.mime}, {formatBytes(row.size)} ({Math.round(row.share * 100)}%)
      </span>{' '}
      <span>{row.used ? t`Used` : t`Unused`}</span>{' '}
      {row.font ? null : (
        <>
          <button
            type="button"
            className="fx-chrome-button"
            aria-label={t`Replace ${row.name}`}
            onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()}
          >
            {t`Replace`}
          </button>
          <input
            type="file"
            accept="image/*"
            aria-hidden="true"
            tabIndex={-1}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onReplace(file);
            }}
          />
        </>
      )}{' '}
      <button type="button" className="fx-chrome-button" aria-label={t`Remove ${row.name}`} disabled={row.used} onClick={() => onRemove()}>
        {t`Remove`}
      </button>
    </li>
  );
}

/**
 * The dialog that lists, replaces and removes the document's assets.
 *
 * @public
 */
export function AssetDialog(props: AssetDialogProps): ReactNode {
  const { store, execute, onClose } = props;
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => store.subscribe(() => setRevision((n) => n + 1)), [store]);
  useEffect(() => {
    // the heading, not the first button (which is disabled when its asset is used): focus lands in the dialog and its name is read
    heading.current?.focus();
  }, []);
  // `revision` is what makes this read again after each commit
  const rows = revision >= 0 ? assetRows(store.toDocument()) : [];
  const unused = unusedAssetIds(rows);
  const total = formatBytes(rows.reduce((sum, r) => sum + r.size, 0));
  const remove = (ids: string[]) => {
    const done = execute('asset.delete', { ids });
    setMessage(done.ok ? '' : done.error.message);
  };
  return (
    <div
      ref={dialog}
      className="fx-chrome-picker fx-chrome-assets"
      role="dialog"
      aria-modal="true"
      aria-label={t`Assets`}
      onKeyDown={(e) => dialogKey(e, onClose)}
    >
      <h2 ref={heading} tabIndex={-1} className="fx-chrome-heading">
        {t`Assets`}
      </h2>
      <p>{t`${plural(rows.length, { one: '# asset', other: '# assets' })}, ${total} in all`}</p>
      {rows.length === 0 ? <p className="fx-chrome-placeholder">{t`This document holds no assets.`}</p> : null}
      <ul className="fx-chrome-assetlist">
        {rows.map((row) => (
          <AssetItem
            key={row.id}
            row={row}
            onReplace={(file) => void replace(props, row, file).then((problem) => setMessage(problem ?? ''))}
            onRemove={() => remove([row.id])}
          />
        ))}
      </ul>
      {message === '' ? null : <p role="alert">{message}</p>}
      <div className="fx-chrome-actions">
        <button type="button" className="fx-chrome-button" disabled={unused.length === 0} onClick={() => remove(unused)}>
          {t`Remove unused (${unused.length})`}
        </button>
        <button type="button" className="fx-chrome-button" onClick={onClose}>
          {t`Close`}
        </button>
      </div>
    </div>
  );
}
