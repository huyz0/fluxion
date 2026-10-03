// The studio shell (04 §4): History API routes to the home page, the editor and present mode. A
// document id opens through documents.ts and bootstrap.ts; the roots come from editor and player.
import { createSession, EditorRoot } from '@fluxion/editor';
import { PlayerRoot } from '@fluxion/player';
import { type JSX, type MouseEvent, type ReactNode, useMemo, useSyncExternalStore } from 'react';
import { cryptoRandom, openDocument } from './bootstrap.js';
import { exampleNames, loadDocument } from './documents.js';
import { localSettings } from './local-settings.js';
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
  return (
    <main data-testid="studio-root">
      <h1>Fluxion Studio</h1>
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
  const opened = useMemo(() => {
    const file = loadDocument(docId, cryptoRandom);
    return file.ok ? openDocument(file.value) : file;
  }, [docId]);
  const settings = useMemo(() => localSettings(), []);
  // the session (selection, camera, tool) lives as long as the document is open here
  const session = useMemo(() => createSession(docId), [docId]);
  if (!opened.ok) return <Problem message={opened.error} />;
  const { core, registries, themes } = opened.value;
  return mode === 'edit' ? (
    <EditorRoot store={core.store} execute={core.execute} registries={registries} settings={settings} session={session} themes={themes} />
  ) : (
    <PlayerRoot store={core.store} registries={registries} />
  );
}

/**
 * The studio shell.
 *
 * @public
 */
export function App(): JSX.Element {
  const route = routeOf(usePath());
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
