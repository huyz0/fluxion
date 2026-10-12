// Upserting compiled screens into a base document (FR-AI-010, ADR-0031): the incremental half of `compile(text, { base })`.
//
// What the source OWNS of a screen (v0, the three-way merge of the Source view is M12.49): the screen record, every element whose `screenId`
// is the screen's id (nodes, groups, connectors) and the bindings of those connectors. Upserting a screen removes all of these from the base
// and puts the freshly compiled ones in their place, so a node deleted from the text goes with its connectors and bindings, and a record that
// did not change keeps its id (ids are hashes of the base's kept salt and the slug keys, ADR-0031) and its bytes. Everything else stays as it
// is: other screens and their elements, and records the compiler does not produce yet (timelines, steps, interactions, comments, assets,
// sections). A screen of the base the text does not name is never deleted; a screen of the text the base lacks is appended.
//
// The document record: the base's is kept. The title and the theme are replaced only when the text names them (a screen block alone has
// neither); `source.deferred` drops the pointers under each upserted screen (`/screens/<id>/…`) and takes the text's, and the text's
// header-level pointers (`/vars`, `/settings`, `/theme/…`) replace the base's of the same pointer. The salt is the base's.
// A base without a document record takes the text's document and theme.
import type { AnyRecord, DocumentFile } from '@fluxion/schema';
import { nKeysBetween } from '@fluxion/schema';

type Rec = { readonly [key: string]: unknown };
type Records = { [id: string]: AnyRecord };

/**
 * What the compiled text named of the header; the rest of the document record stays the base's.
 *
 * @public
 */
export type NamedHeader = {
  /** The text has a `title:`. */
  readonly title: boolean;
  /** The text has a `theme:`. */
  readonly theme: boolean;
};

const rec = (r: AnyRecord): Rec => r as unknown as Rec;
const typeOf = (r: AnyRecord): string => (rec(r)['type'] as string | undefined) ?? '';
const idOf = (r: AnyRecord): string => rec(r)['id'] as string;

/** The ids of the screens of `records`, and of the connectors on them. */
function ownedIds(records: Records, screens: ReadonlySet<string>): ReadonlySet<string> {
  const owned = new Set<string>(screens);
  for (const r of Object.values(records)) if (typeOf(r) === 'element' && screens.has(rec(r)['screenId'] as string)) owned.add(idOf(r));
  return owned;
}

/** Whether the base's record is the source's: a screen of the set, an element on one of them, or a binding of one of their connectors. */
function isOwned(r: AnyRecord, owned: ReadonlySet<string>, screens: ReadonlySet<string>): boolean {
  const f = rec(r);
  const type = typeOf(r);
  if (type === 'screen') return screens.has(idOf(r));
  if (type === 'element') return screens.has(f['screenId'] as string);
  return type === 'binding' && owned.has(f['connectorId'] as string);
}

const slugOf = (r: AnyRecord): string | undefined => (rec(r)['meta'] as Rec | undefined)?.['slug'] as string | undefined;

/** Screens in source order: by `index`, ties by id. */
function byIndex(records: readonly AnyRecord[]): AnyRecord[] {
  const key = (r: AnyRecord) => (rec(r)['index'] as string | undefined) ?? '';
  return [...records].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : idOf(a) < idOf(b) ? -1 : 1));
}

/** The index of a screen new to the base: after the last one (the whole-file compile's own keys, `a0`, `a1`, …, continue the same way). */
function appendedIndex(last: string | undefined): string | undefined {
  const keys = nKeysBetween(last ?? null, null, 1);
  return keys.ok ? keys.value[0] : undefined;
}

/** The `source.deferred` of the merge: the base's without the pointers under an upserted screen, then the text's. */
function mergeDeferred(base: Rec | undefined, fresh: Rec | undefined, slugs: readonly string[]): Rec {
  const prefixes = slugs.map((s) => `/screens/${s}/`);
  const kept = Object.entries(base ?? {}).filter(([pointer]) => !prefixes.some((p) => pointer.startsWith(p)));
  return { ...Object.fromEntries(kept), ...(fresh ?? {}) };
}

function mergeDocument(baseDoc: AnyRecord, freshDoc: AnyRecord, named: NamedHeader, slugs: readonly string[]): AnyRecord {
  const [b, f] = [rec(baseDoc), rec(freshDoc)];
  const [bs, fs] = [b['source'] as Rec | undefined, f['source'] as Rec | undefined];
  return {
    ...b,
    ...(named.title && f['title'] !== undefined ? { title: f['title'] } : {}),
    ...(named.theme ? { themeId: f['themeId'] } : {}),
    source: { ...bs, ...fs, deferred: mergeDeferred(bs?.['deferred'] as Rec | undefined, fs?.['deferred'] as Rec | undefined, slugs) },
  } as unknown as AnyRecord;
}

/** The records of the text that are not the document or a theme: its screens, elements and bindings. */
const compiledRecords = (fresh: DocumentFile): AnyRecord[] => Object.values(fresh.records).filter((r) => !['document', 'theme'].includes(typeOf(r)));

/** The document and theme records of the merge. */
function headerRecords(base: DocumentFile, fresh: DocumentFile, named: NamedHeader, slugs: readonly string[]): AnyRecord[] {
  const all = Object.values(base.records);
  const baseDoc = all.find((r) => typeOf(r) === 'document');
  const freshDoc = Object.values(fresh.records).find((r) => typeOf(r) === 'document');
  const freshThemes = Object.values(fresh.records).filter((r) => typeOf(r) === 'theme');
  if (!baseDoc) return [...(freshDoc ? [freshDoc] : []), ...freshThemes];
  const doc = freshDoc ? mergeDocument(baseDoc, freshDoc, named, slugs) : baseDoc;
  const themeOf = (d: AnyRecord) => rec(d)['themeId'];
  const keepBaseThemes = !named.theme || themeOf(baseDoc) === themeOf(doc);
  const baseThemes = all.filter((r) => typeOf(r) === 'theme' && (keepBaseThemes || idOf(r) !== themeOf(baseDoc)));
  const themes = named.theme ? freshThemes : [];
  const present = new Set([...baseThemes, ...themes].map(idOf));
  const missing = themeOf(doc) !== undefined && !present.has(themeOf(doc) as string) ? freshThemes : [];
  return [doc, ...baseThemes, ...themes, ...missing];
}

/**
 * Put the screens of a freshly compiled text into a base document (see the ownership rules at the top of this file).
 *
 * @param base - the document so far
 * @param fresh - the document the text compiled to on its own
 * @param named - which header parts the text named
 * @returns a new document; `base` is not changed. A record outside the owned set that points at an element the upsert removed is kept as it is (M12.49 decides)
 * @public
 */
export function upsertScreens(base: DocumentFile, fresh: DocumentFile, named: NamedHeader): DocumentFile {
  const compiled = compiledRecords(fresh);
  const freshScreens = byIndex(compiled.filter((r) => typeOf(r) === 'screen'));
  const ids = new Set(freshScreens.map(idOf));
  const owned = ownedIds(base.records, ids);
  const records: Records = {};
  for (const r of Object.values(base.records)) if (!isOwned(r, owned, ids) && !['document', 'theme'].includes(typeOf(r))) records[idOf(r)] = r;
  for (const r of compiled) if (typeOf(r) !== 'screen') records[idOf(r)] = r;
  for (const r of placedScreens(base, freshScreens)) records[idOf(r)] = r;
  for (const r of headerRecords(
    base,
    fresh,
    named,
    freshScreens.flatMap((r) => slugOf(r) ?? []),
  ))
    records[idOf(r)] = r;
  return { ...base, schemaVersion: fresh.schemaVersion, records };
}

/** The compiled screens in source order, each at its place: the index of the base's screen of that id, else after the last one. */
function placedScreens(base: DocumentFile, freshScreens: readonly AnyRecord[]): AnyRecord[] {
  const baseScreens = Object.values(base.records).filter((r) => typeOf(r) === 'screen');
  const existing = new Map(baseScreens.map((r) => [idOf(r), r]));
  const lastScreen = byIndex(baseScreens).pop();
  let lastIndex = lastScreen ? (rec(lastScreen)['index'] as string | undefined) : undefined;
  return freshScreens.map((r) => {
    const before = existing.get(idOf(r));
    const index = before ? (rec(before)['index'] as string | undefined) : appendedIndex(lastIndex);
    if (!before) lastIndex = index;
    return { ...rec(r), ...(index !== undefined ? { index } : {}) } as unknown as AnyRecord;
  });
}
