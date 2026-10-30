// The library panel (FR-LIB-001, M8.30): the registered shape definitions by pack and category, each with a thumbnail
// of its outline drawn at its default size, and a search box over the index of library-search.ts. With a query the
// matches are listed best first. Picking one is the host's (`onPick`, M8.18: click to insert, drag to drop). With
// `onReplace` and a replaceable selection, the Replace toggle (or a shift-click) makes the next pick replace the
// selected shape instead (FR-LIB-011, M18.37). With the host's `importer`, **Import SVG…** picks SVG files or a ZIP and opens the
// import dialog (FR-LIB-004, M18.176). A host's `catalog` adds entries whose geometry is not loaded yet (FR-LIB-009, M18.32):
// they are listed and searched by their pack index's names, drawn as a plain tile until loaded, and picked like any other
// (the host loads the definition first); a registered definition with a catalog entry takes the catalog's names.
import { evaluateOutline, type Registry, type ShapeDef } from '@fluxion/core';
import { pathData, useValue } from '@fluxion/render';
import { plural, t } from '@lingui/core/macro';
import '../i18n.js';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { SvgLibraryInput } from './import-svg-input.js';
import { LibraryImportDialog } from './library-import-dialog.js';
import type { LibraryImporter } from './library-importer.js';
import { LIBRARY_DRAG_TYPE } from './library-insert.js';
import { buildLibraryIndex, entryOf, type LibraryEntry } from './library-search.js';

/**
 * Shape definitions a host offers before their geometry is loaded (FR-LIB-009, M18.32): the entries to list, by their pack
 * index's names, and how to load and register one before it is inserted.
 *
 * @public
 */
export type LibraryCatalog = {
  /** The entries, registered or not. */
  readonly entries: readonly LibraryEntry[];
  /** Load and register the definition `id` when it is not yet; resolves to false when it cannot be (the host has said why). */
  ensure(id: string): Promise<boolean>;
};

/**
 * Props of {@link LibraryPanel}.
 *
 * @public
 */
export type LibraryPanelProps = {
  /** The shape definitions the library lists. */
  readonly shapeDefs: Registry<string, ShapeDef>;
  /** Called with a definition id when its item is picked; without it the items are plain labels. */
  readonly onPick?: ((id: string) => void) | undefined;
  /** Called with a definition id when it should replace the selected shape; without it there is no Replace toggle. */
  readonly onReplace?: ((id: string) => void) | undefined;
  /** Whether the selection is one shape a pick could replace (default false). */
  readonly canReplace?: boolean | undefined;
  /** Registered IDs left out of the listing and search, such as hidden Iconify icons (FR-LIB-005). */
  readonly hidden?: ReadonlySet<string> | undefined;
  /** The host's SVG library import; without it there is no **Import SVG…**. */
  readonly importer?: LibraryImporter | undefined;
  /** Entries the host can load on pick, by their pack index's names (M18.32); a registered definition keeps its own entry otherwise. */
  readonly catalog?: readonly LibraryEntry[] | undefined;
};

const NO_ENTRIES: readonly LibraryEntry[] = [];

/** The picked files as an import input: one ZIP, or SVG files. */
function inputOf(files: readonly File[]): SvgLibraryInput {
  const items = files.map((f) => ({ name: f.name, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) }));
  return { kind: files.length === 1 && /\.zip$/i.test(files[0]?.name ?? '') ? 'zip' : 'files', items };
}

/** **Import SVG…**: a file picker, then the dialog over what was picked. */
function ImportSvg(props: { readonly importer: LibraryImporter }): ReactNode {
  const [input, setInput] = useState<SvgLibraryInput | undefined>(undefined);
  return (
    <>
      <button
        type="button"
        className="fx-chrome-button fx-chrome-library-import"
        onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()}
      >
        {t`Import SVG…`}
      </button>
      <input
        type="file"
        accept=".svg,.zip,image/svg+xml,application/zip"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) setInput(inputOf(files));
        }}
      />
      {input === undefined ? null : <LibraryImportDialog importer={props.importer} input={input} onClose={() => setInput(undefined)} />}
    </>
  );
}

/** The size a thumbnail is drawn in, px. */
const THUMB = { w: 48, h: 36 } as const;

/** The outline of `def` at its default size, as an SVG viewBox and path (nothing when it does not evaluate). */
function outlineOf(def: ShapeDef): { readonly box: string; readonly d: string } | undefined {
  const r = evaluateOutline(def, def.defaultSize);
  return r.ok ? { box: `0 0 ${def.defaultSize.w} ${def.defaultSize.h}`, d: pathData(r.value.commands) } : undefined;
}

/** A thumbnail of one definition. */
function Thumb(props: { readonly def: ShapeDef }): ReactNode {
  const outline = useMemo(() => outlineOf(props.def), [props.def]);
  return (
    <svg className="fx-chrome-library-thumb" width={THUMB.w} height={THUMB.h} viewBox={outline?.box} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {outline === undefined ? null : <path d={outline.d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** The tile of an entry whose geometry is not loaded yet: the thumbnail's box, empty (FR-LIB-009). */
function Pending(): ReactNode {
  return (
    <svg className="fx-chrome-library-thumb" width={THUMB.w} height={THUMB.h} viewBox={`0 0 ${THUMB.w} ${THUMB.h}`} aria-hidden="true">
      <rect
        x={8}
        y={4}
        width={THUMB.w - 16}
        height={THUMB.h - 8}
        rx={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.5}
      />
    </svg>
  );
}

/** One item: a button when something is picked by it, else a label. */
function Item(props: {
  readonly entry: LibraryEntry;
  readonly def: ShapeDef | undefined;
  readonly onPick: ((id: string, shift: boolean) => void) | undefined;
}): ReactNode {
  const { entry, def, onPick } = props;
  const body = (
    <>
      {def === undefined ? <Pending /> : <Thumb def={def} />}
      <span>{entry.name}</span>
    </>
  );
  return (
    <li className="fx-chrome-library-item" data-def-id={entry.id}>
      {onPick === undefined ? (
        <div className="fx-chrome-library-label">{body}</div>
      ) : (
        <button
          type="button"
          className="fx-chrome-button fx-chrome-library-button"
          draggable
          onClick={(e) => onPick(entry.id, e.shiftKey)}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData(LIBRARY_DRAG_TYPE, entry.id);
          }}
        >
          {body}
        </button>
      )}
    </li>
  );
}

/** The entries grouped by pack (in order of the packs' names), then category, each in name order. */
function grouped(entries: readonly LibraryEntry[]): Array<{
  readonly pack: string;
  readonly name: string;
  readonly categories: Array<{ readonly category: string; readonly items: LibraryEntry[] }>;
}> {
  const packs = new Map<string, { name: string; cats: Map<string, LibraryEntry[]> }>();
  for (const e of entries) {
    const pack = packs.get(e.pack) ?? { name: e.pack, cats: new Map<string, LibraryEntry[]>() };
    // any entry that knows the pack's index name names the pack
    if (e.packName !== undefined) pack.name = e.packName;
    pack.cats.set(e.category, [...(pack.cats.get(e.category) ?? []), e]);
    packs.set(e.pack, pack);
  }
  return [...packs]
    .map(([pack, { name, cats }]) => ({ pack, name, categories: [...cats].map(([category, items]) => ({ category, items })) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** What the panel lists: each registered definition's entry, the catalog's where it has one, then the catalog's other entries. */
function listed(defs: ReadonlyMap<string, ShapeDef>, catalog: readonly LibraryEntry[], hidden: ReadonlySet<string> | undefined): LibraryEntry[] {
  const named = new Map(catalog.map((e) => [e.id, e]));
  const registered = [...defs.values()].map((d) => named.get(d.id) ?? entryOf(d));
  return [...registered, ...catalog.filter((e) => !defs.has(e.id))].filter((e) => !hidden?.has(e.id));
}

/**
 * The panel.
 *
 * @public
 */
export function LibraryPanel(props: LibraryPanelProps): ReactNode {
  const { shapeDefs, onPick, onReplace, canReplace = false, hidden, importer, catalog = NO_ENTRIES } = props;
  const [query, setQuery] = useState('');
  const [replacing, setReplacing] = useState(false);
  // losing the replaceable selection lets go of the toggle, so a later selection does not find it still on
  useEffect(() => {
    if (!canReplace) setReplacing(false);
  }, [canReplace]);
  const replaceMode = replacing && canReplace;
  const pick =
    onPick === undefined
      ? undefined
      : (id: string, shift: boolean) => {
          if (onReplace !== undefined && canReplace && (replaceMode || shift)) {
            setReplacing(false);
            onReplace(id);
          } else onPick(id);
        };
  const version = useValue(shapeDefs.changes$);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` stands for the registry's contents
  const defs = useMemo(() => new Map(shapeDefs.list().map(([id, def]) => [id, def] as const)), [shapeDefs, version]);
  const index = useMemo(() => buildLibraryIndex(listed(defs, catalog, hidden)), [defs, catalog, hidden]);
  const found = index.search(query);
  const searching = query.trim() !== '';
  const show = (e: LibraryEntry) => <Item key={e.id} entry={e} def={defs.get(e.id)} onPick={pick} />;
  return (
    <div className="fx-chrome-library">
      <input
        type="search"
        className="fx-chrome-library-search"
        aria-label={t`Search the library`}
        placeholder={t`Search shapes`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {importer === undefined ? null : <ImportSvg importer={importer} />}
      {onReplace === undefined ? null : (
        <button
          type="button"
          className="fx-chrome-button fx-chrome-library-replace"
          aria-pressed={replaceMode}
          disabled={!canReplace}
          title={t`The next shape picked replaces the selected one, keeping its text and connectors (shift-click does it once)`}
          onClick={() => setReplacing(!replaceMode)}
        >
          {t`Replace selected shape`}
        </button>
      )}
      <p className="fx-chrome-library-count" aria-live="polite">
        {plural(found.length, { one: '# shape', other: '# shapes' })}
      </p>
      {searching ? (
        <ul className="fx-chrome-library-list" aria-label={t`Search results`}>
          {found.map(show)}
        </ul>
      ) : (
        grouped(found).map((p) => (
          <section key={p.pack} aria-label={t`Pack ${p.name}`} data-pack={p.pack}>
            {p.categories.map((c) => (
              <div key={c.category}>
                <h3 className="fx-chrome-heading">{`${p.name} / ${c.category}`}</h3>
                <ul className="fx-chrome-library-list" aria-label={`${p.name} ${c.category}`}>
                  {c.items.map(show)}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
