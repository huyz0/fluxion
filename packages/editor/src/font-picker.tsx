// The font picker (FR-THM-008, M9.17): a dialog over the three sources of fonts, the bundled families, the Google Fonts catalog
// and a file the user uploads, with the fonts the document already holds; a family chosen is applied to the selection. The host
// supplies the sources (the studio fetches Google fonts; the editor never names a font host).
import type { Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { buttonsOf, dialogKey } from './dialog-keys.js';
import { applyFontFamily, documentFontFamilies } from './font-apply.js';
import type { Execute } from './pointer.js';

/**
 * What adding a font came to: the family now available, or why not.
 *
 * @public
 */
export type FontOutcome =
  | {
      /** The font was added. */
      readonly ok: true;
      /** The family now available. */
      readonly family: string;
    }
  | {
      /** The font was not added. */
      readonly ok: false;
      /** Why, for the person who chose it. */
      readonly message: string;
    };

/**
 * A family of the Google Fonts catalog, as the picker lists it.
 *
 * @public
 */
export type CatalogEntry = {
  /** The family name. */
  readonly family: string;
  /** Its category (serif, sans-serif, monospace, ...). */
  readonly category: string;
};

/**
 * Where the picker gets fonts from: what the host offers and can add.
 *
 * @public
 */
export type FontSources = {
  /** The families the host bundles and has loaded. */
  readonly bundled: readonly string[];
  /** The Google Fonts catalog (absent: no Google tab). */
  readonly catalog?: () => Promise<readonly CatalogEntry[]>;
  /** Fetch a catalog family into the document (absent: no Google tab). */
  readonly addGoogle?: (family: string) => Promise<FontOutcome>;
  /** Add a font file the user chose to the document. */
  readonly upload: (file: { readonly name: string; readonly bytes: Uint8Array }) => Promise<FontOutcome>;
};

/**
 * Props of {@link FontPicker}.
 *
 * @public
 */
export type FontPickerProps = {
  /** The document store (the fonts it holds are listed, the selection restyled). */
  readonly store: Store;
  /** Runs the style command. */
  readonly execute: Execute;
  /** The selected elements: the family chosen is applied to them. */
  readonly selection: readonly RecordId[];
  /** Where fonts come from. */
  readonly sources: FontSources;
  /** Close the dialog. */
  readonly onClose: () => void;
};

const TABS = ['Document', 'Bundled', 'Google', 'Upload'] as const;
type Tab = (typeof TABS)[number];
/** The most catalog rows shown at once: a search narrows 1 700 families. */
const SHOWN = 40;

const stack = (family: string) => `"${family}", sans-serif`;

/** A list of families with a preview each and a Use button. */
function FamilyList(props: { readonly families: readonly string[]; readonly onUse: (family: string) => void; readonly empty: string }): ReactNode {
  if (props.families.length === 0) return <p>{props.empty}</p>;
  return (
    <ul className="fx-chrome-fontlist">
      {props.families.map((family) => (
        <li key={family} className="fx-chrome-fontrow">
          <span className="fx-chrome-fontpreview" style={{ fontFamily: stack(family) }}>
            {family}: Hamburgefonstiv 0123
          </span>
          <button type="button" className="fx-chrome-button" aria-label={`Use ${family}`} onClick={() => props.onUse(family)}>
            Use
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The Google tab: a search over the catalog and an Add button per family. */
function GoogleTab(props: { readonly sources: FontSources; readonly busy: string | undefined; readonly onAdd: (family: string) => void }): ReactNode {
  const { sources, busy, onAdd } = props;
  const [catalog, setCatalog] = useState<readonly CatalogEntry[] | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void sources.catalog?.().then(setCatalog, () => {
      setCatalog([]);
      setFailed(true);
    });
  }, [sources]);
  const shown = useMemo(() => (catalog ?? []).filter((c) => c.family.toLowerCase().includes(query.trim().toLowerCase())).slice(0, SHOWN), [catalog, query]);
  return (
    <div>
      <input type="search" aria-label="Search Google Fonts" value={query} placeholder="Search Google Fonts" onChange={(e) => setQuery(e.target.value)} />
      {catalog === undefined ? <p>Loading the catalog…</p> : null}
      {failed ? <p role="alert">The Google Fonts catalog could not be loaded. Close the dialog and open it again to retry.</p> : null}
      <ul className="fx-chrome-fontlist">
        {shown.map((entry) => (
          <li key={entry.family} className="fx-chrome-fontrow">
            <span>
              {entry.family} <small>{entry.category}</small>
            </span>
            <button
              type="button"
              className="fx-chrome-button"
              disabled={busy !== undefined}
              aria-label={`Add ${entry.family}`}
              onClick={() => onAdd(entry.family)}
            >
              {busy === entry.family ? 'Adding…' : 'Add'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The most bytes of a font file read: the editor refuses more (5 MB, ADR-0022), so a larger file is not read at all. */
const MAX_UPLOAD = 5 * 1024 * 1024;

/**
 * The dialog: tabs for the document's fonts, the bundled ones, Google's and an upload.
 *
 * @public
 */
export function FontPicker(props: FontPickerProps): ReactNode {
  const { store, execute, sources, onClose } = props;
  const [tab, setTab] = useState<Tab>('Bundled');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const dialog = useRef<HTMLDivElement>(null);
  // the selection as it is when a slow add finishes, not as it was when it began
  const selection = useRef(props.selection);
  selection.current = props.selection;
  const [held, setHeld] = useState(() => documentFontFamilies(store));
  useEffect(() => {
    if (dialog.current) buttonsOf(dialog.current)[0]?.focus();
  }, []);
  const tabs = TABS.filter((t) => t !== 'Google' || (sources.catalog !== undefined && sources.addGoogle !== undefined));
  const use = (family: string) => {
    const applied = applyFontFamily(store, execute, selection.current, family);
    setMessage(applied ? `${family} applied to the selection.` : `${family} is ready; select an element to use it.`);
  };
  const added = (outcome: FontOutcome) => {
    if (!outcome.ok) return setMessage(outcome.message);
    setHeld(documentFontFamilies(store));
    use(outcome.family);
  };
  const addGoogle = (family: string) => {
    setBusy(family);
    setMessage(`Adding ${family}…`);
    void (sources.addGoogle?.(family) ?? Promise.resolve<FontOutcome>({ ok: false, message: 'Google Fonts is not available.' }))
      .catch((): FontOutcome => ({ ok: false, message: `${family} could not be added.` }))
      .then((outcome) => {
        setBusy(undefined);
        added(outcome);
      });
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // the same file chosen again must fire a change again
    input.value = '';
    if (file === undefined) return;
    if (file.size > MAX_UPLOAD) return setMessage(`${file.name} is larger than 5 MB: fonts over 5 MB are not taken.`);
    added(await sources.upload({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }));
  };
  return (
    <div ref={dialog} className="fx-chrome-picker fx-chrome-fonts" role="dialog" aria-modal="true" aria-label="Fonts" onKeyDown={(e) => dialogKey(e, onClose)}>
      <h2 className="fx-chrome-heading">Fonts</h2>
      <div role="tablist" aria-label="Font sources" className="fx-chrome-tabs">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" className="fx-chrome-button" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === 'Document' ? <FamilyList families={held} onUse={use} empty="The document holds no fonts of its own yet." /> : null}
        {tab === 'Bundled' ? <FamilyList families={sources.bundled} onUse={use} empty="No bundled fonts." /> : null}
        {tab === 'Google' ? <GoogleTab sources={sources} busy={busy} onAdd={addGoogle} /> : null}
        {tab === 'Upload' ? (
          <label>
            Font file (WOFF2, TTF or OTF)
            <input type="file" aria-label="Font file" accept=".woff2,.ttf,.otf" onChange={(e) => void upload(e)} />
          </label>
        ) : null}
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button type="button" className="fx-chrome-button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
