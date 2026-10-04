// The studio shell (04 §4): History API routes to the home page, the editor and present mode. A
// document id opens through documents.ts and bootstrap.ts; the roots come from editor and player.
import type { Core } from '@fluxion/core';
import { type AssetStore, createAssetStore, createSession, EditorRoot } from '@fluxion/editor';
import { PlayerRoot } from '@fluxion/player';
import { ok, type RecordId } from '@fluxion/schema';
import { type JSX, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AutosaveBar } from './autosave/autosave-bar.js';
import { cryptoRandom, type OpenDocument, openDocument } from './bootstrap.js';
import { type Guard, useGuard, useProtection } from './document-protection.js';
import { exampleNames, loadDocument } from './documents.js';
import { FileBar, OpenControl, openPicked, pickedFromDrop } from './file-bar.js';
import { browserFileHost } from './file-host.js';
import { fontSources } from './font-sources.js';
import { loadBundledFonts } from './fonts.js';
import { rememberSaved } from './library/library-service.js';
import { RecentFiles } from './library/recent-files.js';
import { localSettings } from './local-settings.js';
import { type OpenedEntry, openedEntry } from './opened-files.js';
import { registerOpenedFonts } from './opened-fonts.js';
import { journalId } from './protection-logic.js';
import { RecoveryHost } from './recovery-host.js';
import { routeOf } from './routes.js';

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};

/** The current path, re-rendering on navigation. */
const usePath = () => useSyncExternalStore(subscribe, () => window.location.pathname);

/** Go to `path` without a page load. */
function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** A link that navigates in place (a modified or middle click keeps the browser's own behaviour). */
function Link(props: { readonly to: string; readonly children: ReactNode }): JSX.Element {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(props.to);
  };
  return (
    <a href={props.to} onClick={onClick}>
      {props.children}
    </a>
  );
}

function Home(): JSX.Element {
  const host = useMemo(() => browserFileHost(), []);
  const [problem, setProblem] = useState('');
  return (
    <main data-testid="studio-root">
      <h1>Fluxion Studio</h1>
      <OpenControl host={host} onOpened={(docId) => navigate(`/edit/${docId}`)} />
      <RecentFiles onOpen={(file) => void openPicked(file, (docId) => navigate(`/edit/${docId}`)).then(setProblem)} />
      <p role="status" aria-live="polite">
        {problem}
      </p>
      <nav aria-label="Documents">
        <ul>
          <li>
            <Link to="/edit/new">New document</Link>
          </li>
          {exampleNames().map((name) => (
            <li key={name}>
              <Link to={`/edit/example-${name}`}>Example: {name}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

function Problem(props: { readonly message: string }): JSX.Element {
  return (
    <main data-testid="studio-root">
      <h1>Fluxion Studio</h1>
      <p role="alert">{props.message}</p>
      <Link to="/">Back to the documents</Link>
    </main>
  );
}

/** The title in the document record, for the recovery list. */
function titleOf(store: Core['store']): string {
  const record = store.get(store.members('byType', 'document')[0] as RecordId);
  const title = (record as { title?: unknown } | undefined)?.title;
  return typeof title === 'string' && title !== '' ? title : 'Untitled';
}

/** The editor over an open document, with its autosave and the status line in the toolbar. */
function ProtectedEditor(props: {
  readonly opened: OpenDocument & { readonly assets: AssetStore; readonly fonts: ReturnType<typeof fontSources> };
  readonly docId: string;
  readonly entry: OpenedEntry | undefined;
  readonly guard: Guard;
  readonly instance: string;
}): JSX.Element {
  const { opened, docId, entry, guard, instance } = props;
  const { core, registries, themes, assets, fonts } = opened;
  const host = useMemo(() => browserFileHost(), []);
  const settings = useMemo(() => localSettings(), []);
  const session = useMemo(() => createSession(docId), [docId]);
  const title = useCallback(() => titleOf(core.store), [core]);
  const { autosave, state } = useProtection({ id: journalId(docId, entry, instance), store: core.store, assets, entry, title, guard });
  return (
    <EditorRoot
      store={core.store}
      execute={core.execute}
      registries={registries}
      settings={settings}
      session={session}
      themes={themes}
      assets={assets}
      fonts={fonts}
      toolbar={
        <>
          <FileBar
            host={host}
            store={core.store}
            assets={assets}
            entry={entry}
            onOpened={(id) => navigate(`/edit/${id}`)}
            onSaved={(saved) => {
              void autosave?.saved();
              void rememberSaved(saved, core.store.toDocument().records);
            }}
          />
          <AutosaveBar state={state} readOnly={guard.phase === 'read-only'} />
        </>
      }
    />
  );
}

/** The document `docId`, opened once per id, in the editor or presented. */
function OpenedDocument(props: { readonly docId: string; readonly mode: 'edit' | 'present'; readonly guard: Guard; readonly instance: string }): JSX.Element {
  const { docId, mode, guard, instance } = props;
  const entry = openedEntry(docId);
  const readOnly = guard.phase === 'read-only';
  const opened = useMemo(() => {
    const file = entry === undefined ? loadDocument(docId, cryptoRandom) : ok(entry.file.document);
    const doc = file.ok ? openDocument(file.value, { readOnly }) : file;
    if (!doc.ok) return doc;
    // the bytes of the document's assets (images, fonts) and the font picker's sources live as long as the document is open here
    const assets = createAssetStore();
    for (const [id, url] of entry?.urls ?? []) assets.set(id, url);
    return ok({ ...doc.value, assets, fonts: fontSources(doc.value.core, assets, cryptoRandom) });
  }, [docId, entry, readOnly]);
  // the fonts a file brings: loaded as faces from its own bytes, with their recorded metrics, for as long as the document is open
  useEffect(() => {
    if (entry === undefined) return;
    let stopped = false;
    let release: (() => void) | undefined;
    void registerOpenedFonts(entry.file.document, entry.urls)
      .then((undo) => {
        if (stopped) undo();
        else release = undo;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      release?.();
    };
  }, [entry]);
  // the bundled fonts, once per page: text in Inter, Source Serif 4 or JetBrains Mono is drawn and measured with the real face
  useEffect(() => {
    void loadBundledFonts();
  }, []);
  if (!opened.ok) return <Problem message={opened.error} />;
  return mode === 'edit' ? (
    <ProtectedEditor opened={opened.value} docId={docId} entry={entry} guard={guard} instance={instance} />
  ) : (
    <PlayerRoot store={opened.value.core.store} registries={opened.value.registries} />
  );
}

/** The page of a document: in the editor this tab first takes the document's lock, so a second tab opens it read-only. */
function DocumentPage(props: { readonly docId: string; readonly mode: 'edit' | 'present' }): JSX.Element {
  const { docId, mode } = props;
  // one id per page load: a new or bundled document is its own document in each tab
  const instance = useMemo(() => crypto.randomUUID(), []);
  const guard = useGuard(journalId(docId, openedEntry(docId), instance), mode === 'edit');
  if (mode === 'edit' && guard.phase === 'starting') return <main data-testid="studio-root" aria-busy="true" />;
  return <OpenedDocument docId={docId} mode={mode} guard={guard} instance={instance} />;
}

/** A file dropped on the page opens (anywhere in the studio); a drag over the page is accepted so the browser does not navigate to the file. */
function useDropToOpen(): string {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      // a drop the editor took (an image on its canvas) is not a file to open
      if (!e.dataTransfer?.types.includes('Files') || e.defaultPrevented) return;
      e.preventDefault();
      setMessage('');
      void pickedFromDrop(e.dataTransfer.files)
        .then((pick) => (pick === undefined ? '' : openPicked(pick, (id) => navigate(`/edit/${id}`))))
        .catch((error: unknown) => `The file could not be read: ${error instanceof Error ? error.message : String(error)}`)
        .then(setMessage);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return message;
}

/**
 * The studio shell.
 *
 * @public
 */
export function App(): JSX.Element {
  const route = routeOf(usePath());
  const dropped = useDropToOpen();
  return (
    <>
      <Routed route={route} />
      <RecoveryHost onOpened={(id) => navigate(`/edit/${id}`)} />
      {dropped === '' ? null : (
        <div role="alert" style={{ position: 'fixed', bottom: 8, left: 8, right: 8, zIndex: 10_000, padding: 8, background: '#fef2f2', color: '#7f1d1d' }}>
          {dropped}
        </div>
      )}
    </>
  );
}

/** The page of `route`. */
function Routed(props: { readonly route: ReturnType<typeof routeOf> }): JSX.Element {
  const { route } = props;
  switch (
    route.kind // kind-switch-allow: the studio's own route union, not an element kind
  ) {
    case 'home':
      return <Home />;
    case 'edit':
    case 'present':
      return <DocumentPage key={`${route.kind}:${route.docId}`} docId={route.docId} mode={route.kind} />;
    default:
      return <Problem message={`Nothing lives at ${route.path}.`} />;
  }
}
