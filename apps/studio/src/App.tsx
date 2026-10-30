// The studio shell (04 §4): History API routes to the home page, the editor and present mode. A
// document id opens through documents.ts and bootstrap.ts; the roots come from editor and player.

import { type Core, writable } from '@fluxion/core';
import { type ArrangePort, type AssetStore, createAssetStore, createGlobalRouting, createSession, EditorRoot, type GlobalRouting } from '@fluxion/editor';
import { PlayerRoot } from '@fluxion/player';
import { ok, type RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type CSSProperties, type JSX, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AiPanel } from './ai/ai-panel.js';
import { registerStoredKeys } from './ai/client.js';
import { createArrangeRunner, layoutOptionsSchemaOf } from './arrange-port.js';
import { AutosaveBar } from './autosave/autosave-bar.js';
import { cryptoRandom, type OpenDocument, openDocument } from './bootstrap.js';
import { studioLogger } from './dev-logger.js';
import { DiagnosticButton } from './diagnostic-button.js';
import { type Guard, useGuard, useProtection } from './document-protection.js';
import { exampleNames, loadDocument } from './documents.js';
import { FileBar, OpenControl, openPicked, pickedFromDrop } from './file-bar.js';
import { browserFileHost } from './file-host.js';
import { fontSources } from './font-sources.js';
import { loadBundledFonts } from './fonts.js';
import { rememberSaved } from './library/library-service.js';
import { RecentFiles } from './library/recent-files.js';
import { studioLibraryImports } from './library-import.js';
import { localSettings } from './local-settings.js';
import { fluxionFileOf, type LaunchHandle, MAX_OPEN_BYTES, pickedFromLaunch, pickedFromUrl, srcOf } from './open-sources.js';
import { type OpenedEntry, openedEntry } from './opened-files.js';
import { registerOpenedFonts } from './opened-fonts.js';
import type { DocumentCatalog } from './pack-catalog.js';
import { CreditsButton } from './pack-credits.js';
import { journalId } from './protection-logic.js';
import { RecoveryHost } from './recovery-host.js';
import { createRoutePort } from './route-port.js';
import { routeOf } from './routes.js';
import { noArtworkFonts, noSavedPacks, useSavedShapePacks } from './saved-shape-packs.js';
import { installTestHooks } from './test-hooks.js';
import { useDocumentCatalog } from './use-document-catalog.js';

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
      <h1>{t`Fluxion Studio`}</h1>
      <OpenControl host={host} onOpened={(docId) => navigate(`/edit/${docId}`)} />
      <RecentFiles onOpen={(file) => void openPicked(file, (docId) => navigate(`/edit/${docId}`)).then(setProblem)} />
      <p role="status" aria-live="polite">
        {problem}
      </p>
      <nav aria-label={t`Documents`}>
        <ul>
          <li>
            <Link to="/edit/new">{t`New document`}</Link>
          </li>
          {exampleNames().map((name) => (
            <li key={name}>
              <Link to={`/edit/example-${name}`}>{t`Example: ${name}`}</Link>
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
      <h1>{t`Fluxion Studio`}</h1>
      <p role="alert">{props.message}</p>
      <Link to="/">{t`Back to the documents`}</Link>
    </main>
  );
}

/** The title in the document record, for the recovery list. */
function titleOf(store: Core['store']): string {
  const record = store.get(store.members('byType', 'document')[0] as RecordId);
  const title = (record as { title?: unknown } | undefined)?.title;
  return typeof title === 'string' && title !== '' ? title : t`Untitled`;
}

/** The Arrange runner of `core`: its layout workers start with the first Arrange and end when the document closes. */
function useArrangeRunner(core: Core): ArrangePort {
  const runner = useMemo(() => createArrangeRunner(core), [core]);
  useEffect(() => () => runner.dispose(), [runner]);
  return runner.port;
}

/**
 * `registries` with the global routing pass's routes (FR-RTE-003): once the document settles, a routing worker routes every orthogonal
 * connector as one batch and the editor draws those routes while the document is unchanged; they are the routes present mode and the
 * `.flux.html` draw (M16.28). The worker ends when the document closes.
 */
function useGlobalRouting(core: Core, registries: OpenDocument['registries']): OpenDocument['registries'] {
  // the pass and its worker belong to the effect, so a remount (StrictMode) disposes one and starts the next; the registries read
  // whichever pass is live through `live`, which is stable for the document
  const live = useMemo(() => writable<{ readonly refined: GlobalRouting['refined'] } | undefined>(undefined), [core, registries]);
  useEffect(() => {
    const port = createRoutePort();
    const global = createGlobalRouting(core.store, registries, port);
    live.set({ refined: global.refined });
    return () => {
      live.set(undefined);
      global.dispose();
      port.dispose();
    };
  }, [core, registries, live]);
  return useMemo(() => ({ ...registries, refined: () => live.get()?.refined() }), [registries, live]);
}

/** The AI panel's frame: bounded by the viewport and scrolling its own content, so a taller panel keeps every control reachable (M18.206). */
const AI_PANEL_STYLE: CSSProperties = {
  position: 'fixed',
  top: 48,
  right: 8,
  maxHeight: 'calc(100vh - 56px)',
  overflowY: 'auto',
  zIndex: 9000,
  background: 'var(--fx-bg, #fff)',
  border: '1px solid #cbd5e1',
};

/** The editor over an open document, with its autosave and the status line in the toolbar. */
function ProtectedEditor(props: {
  readonly opened: OpenDocument & { readonly assets: AssetStore; readonly fonts: ReturnType<typeof fontSources> };
  readonly docId: string;
  readonly entry: OpenedEntry | undefined;
  readonly guard: Guard;
  readonly instance: string;
  readonly catalog: DocumentCatalog | undefined;
}): JSX.Element {
  const { opened, docId, entry, guard, instance, catalog } = props;
  const { core, themes, assets, fonts } = opened;
  const registries = useGlobalRouting(core, opened.registries);
  const host = useMemo(() => browserFileHost(), []);
  const settings = useMemo(() => localSettings(), []);
  const session = useMemo(() => createSession(docId), [docId]);
  const title = useCallback(() => titleOf(core.store), [core]);
  const arrange = useArrangeRunner(core);
  const layoutOptionsSchema = useMemo(() => layoutOptionsSchemaOf(core), [core]);
  const [aiOpen, setAiOpen] = useState(false);
  useEffect(() => {
    void registerStoredKeys();
  }, []);
  useEffect(() => installTestHooks({ store: core.store, execute: core.execute, registries: core.registries, session }), [core, session]);
  const { autosave, state } = useProtection({ id: journalId(docId, entry, instance), store: core.store, assets, entry, title, guard });
  // SVG libraries imported here (FR-LIB-004): registered into this document, their sources saved with it, released when it closes
  const imports = useMemo(() => studioLibraryImports(opened, { document, fetch: (...args) => fetch(...args), now: () => Date.now() }), [opened]);
  useEffect(() => () => imports.dispose(), [imports]);
  const shapePackSources = useSyncExternalStore(imports.subscribe, imports.sources);
  // what a save embeds, read when it is needed: the imported libraries' sources, then the first-party definitions loaded
  const saveSources = () => [...shapePackSources, ...(catalog?.sources() ?? [])];
  return (
    <>
      <EditorRoot
        store={core.store}
        execute={core.execute}
        registries={registries}
        sourceRegistries={core.registries}
        layoutOptionsSchema={layoutOptionsSchema}
        settings={settings}
        session={session}
        themes={themes}
        assets={assets}
        fonts={fonts}
        arrange={arrange}
        libraryImporter={imports.importer}
        {...(catalog === undefined ? {} : { catalog })}
        toolbar={
          <>
            <FileBar
              host={host}
              store={core.store}
              assets={assets}
              entry={entry}
              shapePackSources={saveSources}
              onOpened={(id) => navigate(`/edit/${id}`)}
              onSaved={(saved) => {
                void autosave?.saved();
                void rememberSaved(saved, core.store.toDocument().records);
              }}
            />
            <AutosaveBar state={state} readOnly={guard.phase === 'read-only'} />
            <DiagnosticButton store={core.store} />
            <CreditsButton store={core.store} saved={entry?.file.shapePacks ?? []} sources={saveSources} names={catalog?.names} />
            <button type="button" aria-pressed={aiOpen} onClick={() => setAiOpen((open) => !open)}>
              {t`AI assistant`}
            </button>
          </>
        }
      />
      {aiOpen ? (
        <div style={AI_PANEL_STYLE}>
          <AiPanel store={core.store} execute={core.execute} registries={core.registries} session={session} />
        </div>
      ) : null}
    </>
  );
}

/** The document `docId`, opened once per id, in the editor or presented. */
function OpenedDocument(props: { readonly docId: string; readonly mode: 'edit' | 'present'; readonly guard: Guard; readonly instance: string }): JSX.Element {
  const { docId, mode, guard, instance } = props;
  const entry = openedEntry(docId);
  const readOnly = guard.phase === 'read-only';
  const opened = useMemo(() => {
    const file = entry === undefined ? loadDocument(docId, cryptoRandom) : ok(entry.file.document);
    const doc = file.ok ? openDocument(file.value, { readOnly, logger: studioLogger(window.location.search, console).child('studio') }) : file;
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
  // the file's saved packs, their exact artwork fonts first, before the document is shown (M18.115)
  const packs = useSavedShapePacks(opened, entry?.file.shapePacks ?? noSavedPacks, entry?.file.artworkFonts ?? noArtworkFonts);
  const catalog = useDocumentCatalog(opened.ok ? opened.value.core : undefined, entry?.file.shapePacks ?? noSavedPacks);
  if (!opened.ok) return <Problem message={opened.error} />;
  if (packs.phase === 'refused') return <Problem message={packs.message} />;
  if (packs.phase === 'registering') return <main data-testid="studio-root" aria-busy="true" />;
  return mode === 'edit' ? (
    <ProtectedEditor opened={opened.value} docId={docId} entry={entry} guard={guard} instance={instance} catalog={catalog} />
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

/** The `?src=` URLs already fetched by this page. */
const fetchedSources = new Set<string>();

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
    // a Fluxion file pasted outside a text field opens (an image pasted into the editor is the editor's: it has taken the event)
    const paste = (e: ClipboardEvent) => {
      const file = e.defaultPrevented ? undefined : fluxionFileOf(e.clipboardData);
      if (file === undefined || (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')))
        return;
      e.preventDefault();
      setMessage('');
      if (file.size > MAX_OPEN_BYTES) return setMessage(`${file.name} is larger than ${MAX_OPEN_BYTES} bytes and cannot be opened.`);
      void pickedFromDrop([file])
        .then((pick) => (pick === undefined ? '' : openPicked(pick, (id) => navigate(`/edit/${id}`))))
        .catch((error: unknown) => `The file could not be read: ${error instanceof Error ? error.message : String(error)}`)
        .then(setMessage);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    // the page was opened with ?src=<url>: fetch that file and open it
    const src = srcOf(window.location.search, window.location.href);
    if (src !== undefined && !fetchedSources.has(src.href)) {
      fetchedSources.add(src.href); // once per page load, though a development StrictMode runs the effect twice
      void pickedFromUrl(src, (...args) => fetch(...args))
        .then((got) => (got.ok ? openPicked(got.value, (id) => navigate(`/edit/${id}`)) : got.error))
        .then(setMessage);
    }
    // the installed app launched with a file (a double click in the file manager)
    (window as LaunchWindow).launchQueue?.setConsumer((params) => {
      void pickedFromLaunch(params.files)
        .then((pick) => (pick === undefined ? '' : openPicked(pick, (id) => navigate(`/edit/${id}`))))
        .catch((error: unknown) => `The file could not be read: ${error instanceof Error ? error.message : String(error)}`)
        .then(setMessage);
    });
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, []);
  return message;
}

/** The launch queue of an installed app (Chromium), where the window has one. */
type LaunchWindow = Window & { launchQueue?: { setConsumer(consumer: (params: { readonly files: readonly LaunchHandle[] }) => void): void } };

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
