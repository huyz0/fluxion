// The recovery prompt in the studio (FR-FIL-007): looks once, when the studio starts, for what the last session left unsaved, offers it, and opens
// a recovered document in the editor as a document that has not been saved to a file.
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { type BrowserAutosave, browserAutosave } from './autosave/browser.js';
import { documentOf, findRecoverable, type Recoverable, recoveredAssets } from './autosave/recovery.js';
import { RecoveryPrompt } from './autosave/recovery-prompt.js';
import type { OpenedFile } from './file-session.js';
import { assetUrls, type OpenedEntry, registerOpened } from './opened-files.js';

/**
 * The editor entry for a recovered document: named after its title, not saved to any file (Save asks for a name), carrying on its own journal.
 *
 * @public
 */
export async function recoveredEntry(item: Recoverable, env: Pick<BrowserAutosave, 'blobs'>): Promise<OpenedEntry> {
  const file: OpenedFile = {
    name: `${item.recovery.title.replace(/[\\/:*?"<>|]+/g, '-')}.flux`,
    kind: 'flux',
    document: documentOf(item),
    assets: await recoveredAssets(item, env.blobs),
    readOnly: false,
    notes: [],
    extraEntries: new Map(),
    manifestExtras: {},
  };
  return { identity: `recovered:${item.id}`, resume: item.id, file, urls: await assetUrls(file) };
}

/**
 * Offer what the last session left unsaved. Renders nothing when there is none.
 *
 * @public
 */
export function RecoveryHost(props: { readonly onOpened: (docId: string) => void }): JSX.Element | null {
  const [offer, setOffer] = useState<{ env: BrowserAutosave; items: readonly Recoverable[] } | undefined>();
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let stopped = false;
    let env: BrowserAutosave | undefined;
    void browserAutosave().then(async (opened) => {
      env = opened;
      const items = await findRecoverable(opened.journal, opened.lock);
      if (stopped || items.length === 0) return;
      setOffer({ env: opened, items });
    });
    return () => {
      stopped = true;
      env?.close();
    };
  }, []);
  if (offer === undefined) return null;
  const { env, items } = offer;
  // functional updates: a slow Discard of one row must not bring back a row that was recovered meanwhile
  const without = (id: string): void =>
    setOffer((now) => {
      const rest = now?.items.filter((i) => i.id !== id) ?? [];
      return now === undefined || rest.length === 0 ? undefined : { env: now.env, items: rest };
    });
  const back = (item: Recoverable): void =>
    setOffer((now) =>
      now === undefined ? { env, items: [item] } : now.items.some((i) => i.id === item.id) ? now : { env: now.env, items: [...now.items, item] },
    );
  return (
    <>
      <RecoveryPrompt
        items={items}
        onClose={() => setOffer(undefined)}
        onRecover={(item) => {
          // the row goes at once: a second click on it, or a Discard of the journal the editor is about to write to, must not be possible
          without(item.id);
          void recoveredEntry(item, env)
            .then((entry) => props.onOpened(registerOpened(entry)))
            .catch((e: unknown) => {
              back(item);
              setProblem(`The document could not be recovered: ${e instanceof Error ? e.message : String(e)}`);
            });
        }}
        onDiscard={(item) =>
          void env.journal
            .discard(item.id)
            .then(() => without(item.id))
            .catch((e: unknown) => setProblem(`The unsaved changes could not be discarded: ${e instanceof Error ? e.message : String(e)}`))
        }
      />
      {problem === '' ? null : <p role="alert">{problem}</p>}
    </>
  );
}
