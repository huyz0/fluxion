// The studio's file controls (FR-FIL-006, NFR-REL-001, M10.17): Open, Save and Save a copy over a document, and what to tell the person about the
// file they opened. Save writes over the file only when the file may be written over (a whole `.flux` this major version wrote) and the
// browser gave a handle; anything else, and Save a copy, asks for a new name. Ctrl or Cmd+S is Save.

import type { Store } from '@fluxion/core';
import type { AssetStore } from '@fluxion/editor';
import type { FluxAsset } from '@fluxion/format';
import { createId, type RecordId, type Result } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { FileHost, PickedFile } from './file-host.js';
import { describeFile, fileBytes, mayOverwrite, openFileBytes, type SavedBytes, webHasher } from './file-session.js';
import { bundledFontsFor } from './font-embed.js';
import { embeddableFaces } from './fonts.js';
import { heldBytes } from './held-bytes.js';
import { assetUrls, type OpenedEntry, registerOpened } from './opened-files.js';
import { cryptoRandom } from './random.js';

/** The version the manifest of a saved file names. */
const STUDIO_VERSION = '0.0.0';

/** Props of {@link FileBar}. */
export type FileBarProps = {
  /** The browser's file functions. */
  readonly host: FileHost;
  /** The open document's store (what is saved is its current state). */
  readonly store: Store;
  /** The bytes of the open document's assets that the editor holds. */
  readonly assets: AssetStore;
  /** The file this document was opened from, if it was opened from one. */
  readonly entry: OpenedEntry | undefined;
  /** Go to the editor of the document `docId`. */
  readonly onOpened: (docId: string) => void;
  /** Called after the file was written, with its name and bytes (autosave marks the journal saved; the library keeps a copy). */
  readonly onSaved?: (saved: { readonly name: string; readonly bytes: Uint8Array }) => void;
};

/** The name a save suggests: the file's own name (or the document's title) as a `.flux`. */
function suggestedName(entry: OpenedEntry | undefined, store: Store): string {
  const title = (store.toDocument().records[store.members('byType', 'document')[0] as RecordId] as { title?: unknown } | undefined)?.title;
  const base = entry?.file.name.replace(/\.(flux\.html|flux\.json|flux|html|json)$/i, '') ?? (typeof title === 'string' && title !== '' ? title : t`document`);
  return `${base.replace(/[\\/:*?"<>|]+/g, '-')}.flux`;
}

/**
 * The whole document as `.flux` bytes: what Save writes and what a version snapshot keeps.
 *
 * @public
 */
export function currentFile(entry: OpenedEntry | undefined, store: Store, assets: AssetStore): Promise<Result<SavedBytes, string>> {
  return fileBytes({
    file: entry?.file,
    document: store.toDocument(),
    bytesOf: (id) => heldBytes(assets, id),
    hasher: webHasher,
    appVersion: STUDIO_VERSION,
    fonts: (document) =>
      bundledFontsFor(document, { faces: embeddableFaces(), newId: () => createId(cryptoRandom), sha256: (bytes) => webHasher.sha256(bytes) }),
  });
}

/** A failure as one line for the person. */
const lineOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Open the picked file: read it, register it, and go to its editor; or say why not. Never rejects: a failure is the line it returns. */
export async function openPicked(pick: PickedFile, onOpened: (docId: string) => void): Promise<string> {
  try {
    const opened = await openFileBytes(pick.name, pick.bytes, webHasher);
    if (!opened.ok) return opened.error;
    const identity = `${pick.name}:${(await webHasher.sha256(pick.bytes)).slice(0, 16)}`;
    const entry: OpenedEntry = {
      identity,
      file: opened.value,
      urls: await assetUrls(opened.value),
      ...(pick.handle === undefined ? {} : { handle: pick.handle }),
    };
    onOpened(registerOpened(entry));
    return '';
  } catch (e) {
    return t`${pick.name} cannot be opened: ${lineOf(e)}`;
  }
}

/** Ask the person for a file and open it. Never rejects: a picker that fails, a file that cannot be read or opened is the line it returns. */
export async function openWithHost(host: FileHost, onOpened: (docId: string) => void): Promise<string> {
  try {
    const pick = await host.openFile();
    return pick === undefined ? '' : await openPicked(pick, onOpened);
  } catch (e) {
    return t`The file could not be opened: ${lineOf(e)}`;
  }
}

/**
 * Open, Save and Save a copy for the open document.
 *
 * @public
 */
export function FileBar(props: FileBarProps): JSX.Element {
  const { host, store, assets, entry, onOpened, onSaved } = props;
  const [message, setMessage] = useState('');
  // the handle the next Save writes through: the file's own when it may be written over, else the copy that was saved last
  const target = useRef<unknown>(entry !== undefined && mayOverwrite(entry.file) ? entry.handle : undefined);
  // one save at a time: a held Ctrl+S or a double click must not open two pickers or finish two writes out of order
  const saving = useRef(false);
  const saveAs = useCallback(
    async (bytes: Uint8Array) => {
      const saved = await host.saveAs(suggestedName(entry, store), bytes);
      if (saved === undefined) return '';
      if (saved.handle !== undefined) target.current = saved.handle;
      onSaved?.({ name: saved.name, bytes });
      return t`Saved ${saved.name}.`;
    },
    [host, entry, store, onSaved],
  );
  const overwrite = useCallback(
    async (handle: unknown, bytes: Uint8Array) => {
      await host.writeOver(handle, bytes);
      onSaved?.({ name: entry?.file.name ?? suggestedName(entry, store), bytes });
      return t`Saved.`;
    },
    [host, onSaved, entry, store],
  );
  const save = useCallback(
    async (copy: boolean) => {
      if (saving.current) return;
      saving.current = true;
      try {
        const made = await currentFile(entry, store, assets);
        if (!made.ok) return setMessage(made.error);
        const warning = made.value.missing > 0 ? t` ${made.value.missing} assets had no bytes to write.` : '';
        const said = !copy && target.current !== undefined ? await overwrite(target.current, made.value.bytes) : await saveAs(made.value.bytes);
        setMessage(`${said}${warning}`);
      } catch (e) {
        setMessage(t`The file was not saved: ${lineOf(e)}`);
      } finally {
        saving.current = false;
      }
    },
    [entry, store, assets, saveAs, overwrite],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);
  const notes = entry === undefined ? [] : describeFile(entry.file);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset draws a border and a legend box; `display: contents` lets the buttons join the editor toolbar's own layout
    <div role="group" aria-label={t`File`} className="fx-studio-filebar" style={{ display: 'contents' }}>
      <button type="button" className="fx-chrome-button" onClick={() => void openWithHost(host, onOpened).then(setMessage)}>
        {t`Open…`}
      </button>
      <button type="button" className="fx-chrome-button" onClick={() => void save(false)}>
        {t`Save`}
      </button>
      <button type="button" className="fx-chrome-button" onClick={() => void save(true)}>
        {t`Save a copy`}
      </button>
      <span role="status" aria-live="polite">
        {[message, ...notes].filter((m) => m !== '').join(' ')}
      </span>
    </div>
  );
}

/**
 * Just Open, for the home page, with the message when a file cannot be opened.
 *
 * @public
 */
export function OpenControl(props: { readonly host: FileHost; readonly onOpened: (docId: string) => void }): JSX.Element {
  const [message, setMessage] = useState('');
  return (
    <p>
      <button type="button" onClick={() => void openWithHost(props.host, props.onOpened).then(setMessage)}>
        {t`Open a file…`}
      </button>{' '}
      <span role="status" aria-live="polite">
        {message}
      </span>
    </p>
  );
}

/** The first file of a drop, as a picked file. */
export async function pickedFromDrop(files: ArrayLike<File> | null | undefined): Promise<PickedFile | undefined> {
  const file = files?.[0];
  return file === undefined ? undefined : { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
