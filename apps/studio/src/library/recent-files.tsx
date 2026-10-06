// The recent files on the home page (FR-FIL-008): what the person saved in this browser, newest first, each with its preview, to open again.
import { t } from '@lingui/core/macro';
import { type JSX, useEffect, useState } from 'react';
import { library } from './library-service.js';
import type { LibraryEntry } from './store.js';

/** How many recent files the home page lists. */
const SHOWN = 12;

/** The preview of one entry as an image; the object URL is let go of when it is replaced or the row goes. */
function Thumb(props: { readonly entry: LibraryEntry }): JSX.Element | null {
  const { thumb } = props.entry;
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (thumb === undefined) return;
    const made = URL.createObjectURL(new Blob([thumb.slice().buffer], { type: 'image/webp' }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [thumb]);
  return url === undefined ? null : <img src={url} alt="" width={160} style={{ display: 'block', border: '1px solid #cbd5e1' }} />;
}

/**
 * The list. `onOpen` is given the name and bytes of the entry the person chose.
 *
 * @public
 */
export function RecentFiles(props: { readonly onOpen: (file: { readonly name: string; readonly bytes: Uint8Array }) => void }): JSX.Element | null {
  const [entries, setEntries] = useState<readonly LibraryEntry[]>([]);
  useEffect(() => {
    let stopped = false;
    void library()
      .then((lib) => lib?.recent(SHOWN))
      .then((found) => {
        if (!stopped && found !== undefined) setEntries(found);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);
  if (entries.length === 0) return null;
  return (
    <section aria-label={t`Recent files`}>
      <h2>{t`Recent files`}</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button type="button" className="fx-chrome-button" onClick={() => props.onOpen({ name: entry.name, bytes: entry.bytes })}>
              <Thumb entry={entry} />
              {entry.name}
            </button>
            <div style={{ fontSize: 12 }}>{new Date(entry.saved).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
