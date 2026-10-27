// The library panel (FR-LIB-001, M8.30): the registered shape definitions by pack and category, each with a thumbnail
// of its outline drawn at its default size, and a search box over the index of library-search.ts. With a query the
// matches are listed best first. Picking one is the host's (`onPick`, M8.18: click to insert, drag to drop). With
// `onReplace` and a replaceable selection, the Replace toggle (or a shift-click) makes the next pick replace the
// selected shape instead (FR-LIB-011, M18.37).
import { evaluateOutline, type Registry, type ShapeDef } from '@fluxion/core';
import { pathData, useValue } from '@fluxion/render';
import { plural, t } from '@lingui/core/macro';
import '../i18n.js';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { LIBRARY_DRAG_TYPE } from './library-insert.js';
import { buildLibraryIndex, entryOf, type LibraryEntry } from './library-search.js';

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
};

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

/** One item: a button when something is picked by it, else a label. */
function Item(props: { readonly entry: LibraryEntry; readonly def: ShapeDef; readonly onPick: ((id: string, shift: boolean) => void) | undefined }): ReactNode {
  const { entry, def, onPick } = props;
  const body = (
    <>
      <Thumb def={def} />
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

/** The entries grouped by pack, then category, each in name order. */
function grouped(
  entries: readonly LibraryEntry[],
): Array<{ readonly pack: string; readonly categories: Array<{ readonly category: string; readonly items: LibraryEntry[] }> }> {
  const packs = new Map<string, Map<string, LibraryEntry[]>>();
  for (const e of entries) {
    const cats = packs.get(e.pack) ?? new Map<string, LibraryEntry[]>();
    cats.set(e.category, [...(cats.get(e.category) ?? []), e]);
    packs.set(e.pack, cats);
  }
  return [...packs].map(([pack, cats]) => ({ pack, categories: [...cats].map(([category, items]) => ({ category, items })) }));
}

/**
 * The panel.
 *
 * @public
 */
export function LibraryPanel(props: LibraryPanelProps): ReactNode {
  const { shapeDefs, onPick, onReplace, canReplace = false, hidden } = props;
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
  const index = useMemo(() => buildLibraryIndex([...defs.values()].filter((d) => !hidden?.has(d.id)).map(entryOf)), [defs, hidden]);
  const found = index.search(query);
  const searching = query.trim() !== '';
  const show = (e: LibraryEntry) => <Item key={e.id} entry={e} def={defs.get(e.id) as ShapeDef} onPick={pick} />;
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
          <section key={p.pack} aria-label={t`Pack ${p.pack}`} data-pack={p.pack}>
            {p.categories.map((c) => (
              <div key={c.category}>
                <h3 className="fx-chrome-heading">{`${p.pack} / ${c.category}`}</h3>
                <ul className="fx-chrome-library-list" aria-label={`${p.pack} ${c.category}`}>
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
