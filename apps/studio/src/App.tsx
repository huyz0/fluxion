// The studio shell (04 §4): History API routes to the home page, the editor and present mode. A
// document id opens through documents.ts and bootstrap.ts; the roots come from editor and player.
import { createAssetStore, createSession, EditorRoot } from '@fluxion/editor';
import { PlayerRoot } from '@fluxion/player';
import { ok } from '@fluxion/schema';
import { type JSX, type MouseEvent, type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { cryptoRandom, openDocument } from './bootstrap.js';
import { exampleNames, loadDocument } from './documents.js';
import { FileBar, OpenControl, openPicked, pickedFromDrop } from './file-bar.js';
import { browserFileHost } from './file-host.js';
import { fontSources } from './font-sources.js';
import { loadBundledFonts } from './fonts.js';
import { localSettings } from './local-settings.js';
import { openedEntry } from './opened-files.js';
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
  return (
    <main data-testid="studio-root">
      <h1>Fluxion Studio</h1>
      <OpenControl host={host} onOpened={(docId) => navigate(`/edit/${docId}`)} />
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

/** The document `docId`, opened once per id, in the editor or presented. */
function DocumentPage(props: { readonly docId: string; readonly mode: 'edit' | 'present' }): JSX.Element {
  const { docId, mode } = props;
  const host = useMemo(() => browserFileHost(), []);
  const entry = openedEntry(docId);
  const opened = useMemo(() => {
    const file = entry === undefined ? loadDocument(docId, cryptoRandom) : ok(entry.file.document);
    const doc = file.ok ? openDocument(file.value) : file;
    if (!doc.ok) return doc;
    // the bytes of the document's assets (images, fonts) and the font picker's sources live as long as the document is open here
    const assets = createAssetStore();
    for (const [id, url] of entry?.urls ?? []) assets.set(id, url);
    return ok({ ...doc.value, assets, fonts: fontSources(doc.value.core, assets, cryptoRandom) });
  }, [docId, entry]);
  const settings = useMemo(() => localSettings(), []);
  // the bundled fonts, once per page: text in Inter, Source Serif 4 or JetBrains Mono is drawn and measured with the real face
  useEffect(() => {
    void loadBundledFonts();
  }, []);
  // the session (selection, camera, tool) lives as long as the document is open here
  const session = useMemo(() => createSession(docId), [docId]);
  if (!opened.ok) return <Problem message={opened.error} />;
  const { core, registries, themes, assets, fonts } = opened.value;
  return mode === 'edit' ? (
    <EditorRoot
      store={core.store}
      execute={core.execute}
      registries={registries}
      settings={settings}
      session={session}
      themes={themes}
      assets={assets}
      fonts={fonts}
      toolbar={<FileBar host={host} store={core.store} assets={assets} entry={entry} onOpened={(id) => navigate(`/edit/${id}`)} />}
    />
  ) : (
    <PlayerRoot store={core.store} registries={registries} />
  );
}

/** A file dropped on the page opens (anywhere in the studio); a drag over the page is accepted so the browser does not navigate to the file. */
function useDropToOpen(): string {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
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
