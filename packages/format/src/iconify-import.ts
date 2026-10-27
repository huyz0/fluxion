import { parseShapeDef } from '@fluxion/core';
import { type Diagnostic, qualifiedNameSchema } from '@fluxion/schema';
import type { IconifyIconOutcome, IconifyImportOptions, IconifyImportReport, IconifyProvenance } from './iconify-import-types.js';
import { sha256Hex } from './sha256.js';
import { importSvgShape } from './svg-import.js';
import { encodeUtf8 } from './utf8.js';

export type { IconifyIconOutcome, IconifyImportOptions, IconifyImportReport, IconifyProcessedReport, IconifyProvenance } from './iconify-import-types.js';

/** Bounds checked before JSON parsing and conversion (ADR-0049). */
const MAX_CHARS = 32 * 1024 * 1024;
const MAX_ENTRIES = 50_000;
const MAX_ALIAS_DEPTH = 32;
/** Total SVG text converted per collection: aliases re-convert their root's body, so input size alone does not bound work. */
const MAX_WORK_CHARS = 16 * 1024 * 1024;
const PREFIX = /^[a-z0-9][a-z0-9-]*$/;

type Box = { left: number; top: number; width: number; height: number };
type Props = Box & { rotate: number; hFlip: boolean; vFlip: boolean; hidden: boolean };
type Key = 'body' | 'hidden' | 'parent' | 'left' | 'top' | 'width' | 'height' | 'rotate' | 'hFlip' | 'vFlip';
/** A source object; known Iconify fields are read by name, anything else is ignored. */
type Raw = { readonly [K in Key | 'prefix' | 'icons' | 'aliases' | 'categories' | 'info' | 'author' | 'license' | 'name' | 'spdx']?: unknown };

const problem = (message: string, path = ''): Diagnostic => ({ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path, message });
const failed = (message: string): IconifyImportReport => ({ status: 'failed', diagnostics: [problem(message)] });
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const FIELDS: readonly (readonly [keyof Props, (v: unknown) => boolean])[] = [
  ['left', finite],
  ['top', finite],
  ['width', (v) => finite(v) && (v as number) > 0],
  ['height', (v) => finite(v) && (v as number) > 0],
  ['rotate', Number.isInteger],
  ['hFlip', (v) => typeof v === 'boolean'],
  ['vFlip', (v) => typeof v === 'boolean'],
  ['hidden', (v) => typeof v === 'boolean'],
];

/** One field over its inherited value: an alias adds rotations and XORs flips (Iconify's mergeIconTransformations). */
function merged(key: keyof Props, base: Props, v: unknown, alias: boolean): number | boolean {
  if (alias && key === 'rotate') return base.rotate + (v as number);
  if (alias && (key === 'hFlip' || key === 'vFlip')) return base[key] !== v;
  return v as number | boolean;
}

/** Validate and apply one property object's overrides; undefined when a known field has the wrong type. */
function overlay(base: Props, raw: Raw, alias: boolean): Props | undefined {
  const out: Record<keyof Props, number | boolean> = { ...base };
  for (const [key, valid] of FIELDS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!valid(v)) return undefined;
    out[key] = merged(key, base, v, alias);
  }
  return out as Props;
}

/** Flips as transforms (both flips are a half turn); the remaining quarter turns. */
function flipped(props: Props, box: Box, transforms: string[]): number {
  if (props.hFlip && props.vFlip) return props.rotate + 2;
  if (props.hFlip) transforms.push(`translate(${box.width + box.left} ${-box.top})`, 'scale(-1 1)');
  else if (props.vFlip) transforms.push(`translate(${-box.left} ${box.height + box.top})`, 'scale(1 -1)');
  if (props.hFlip || props.vFlip) box.left = box.top = 0;
  return props.rotate;
}

const ROTATIONS: readonly ((box: Box) => string | undefined)[] = [
  () => undefined,
  (box) => `rotate(90 ${box.height / 2 + box.top} ${box.height / 2 + box.top})`,
  (box) => `rotate(180 ${box.width / 2 + box.left} ${box.height / 2 + box.top})`,
  (box) => `rotate(-90 ${box.width / 2 + box.left} ${box.width / 2 + box.left})`,
];

/** Iconify's icon-level transformation: flips then quarter rotations, wrapping the body once. */
function svgOf(body: string, props: Props): string {
  const box: Box = { left: props.left, top: props.top, width: props.width, height: props.height };
  const transforms: string[] = [];
  const rotation = ((flipped(props, box, transforms) % 4) + 4) % 4;
  const turn = (ROTATIONS[rotation] as (box: Box) => string | undefined)(box);
  if (turn) transforms.unshift(turn);
  if (rotation % 2 === 1) [box.left, box.top, box.width, box.height] = [box.top, box.left, box.height, box.width];
  const content = transforms.length ? `<g transform="${transforms.join(' ')}">${body}</g>` : body;
  const view = `${box.left} ${box.top} ${box.width} ${box.height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${view}">${content}</svg>`;
}

function provenanceOf(doc: Raw, prefix: string, text: string): IconifyProvenance {
  const info = isRecord(doc.info) ? doc.info : {};
  const author = isRecord(info.author) ? info.author.name : undefined;
  const license = isRecord(info.license) ? info.license.spdx : undefined;
  return {
    prefix,
    sourceSha256: sha256Hex(encodeUtf8(text)),
    ...(typeof info.name === 'string' ? { name: info.name } : {}),
    ...(typeof author === 'string' ? { author } : {}),
    ...(typeof license === 'string' ? { license } : {}),
  };
}

/** Category membership in source order; the first listing category becomes the picker category. */
function categoriesOf(doc: Raw): Map<string, string[]> | undefined {
  const out = new Map<string, string[]>();
  const raw = doc.categories;
  if (raw === undefined) return out;
  if (!isRecord(raw)) return undefined;
  for (const [category, names] of Object.entries(raw)) {
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) return undefined;
    for (const name of names as string[]) out.set(name, [...(out.get(name) ?? []), category]);
  }
  return out;
}

type Resolved = { readonly props: Props; readonly body: string; readonly root: string } | { readonly error: string };

/** The aliases from `name` up to its root icon, nearest first, with bounded depth and cycle/missing-parent detection. */
function chainOf(name: string, icons: ReadonlyMap<string, Raw>, aliases: ReadonlyMap<string, Raw>): { chain: Raw[]; root: string } | { error: string } {
  const chain: Raw[] = [];
  const seen = new Set<string>();
  let at = name;
  while (!icons.has(at)) {
    const alias = aliases.get(at);
    if (alias === undefined) return { error: `missing-parent: ${at}` };
    if (seen.has(at)) return { error: `alias-cycle: ${name} reaches ${at} again` };
    if (chain.length >= MAX_ALIAS_DEPTH) return { error: `alias-depth: more than ${MAX_ALIAS_DEPTH} levels` };
    if (typeof alias.parent !== 'string') return { error: `invalid-alias: ${at} has no parent` };
    seen.add(at);
    chain.push(alias);
    at = alias.parent;
  }
  return { chain, root: at };
}

/** Resolve an alias: its root icon's properties overlaid by each alias from the root down. */
function resolveAlias(name: string, icons: ReadonlyMap<string, Raw>, aliases: ReadonlyMap<string, Raw>, defaults: Props): Resolved {
  const found = chainOf(name, icons, aliases);
  if ('error' in found) return found;
  const resolved = resolveIcon(icons.get(found.root) as Raw, defaults);
  if ('error' in resolved) return resolved;
  let props: Props | undefined = resolved.props;
  for (const alias of found.chain.reverse()) {
    props = overlay(props, alias, true);
    if (!props) return { error: 'invalid-icon-properties' };
  }
  return { props, body: resolved.body, root: found.root };
}

function resolveIcon(icon: Raw, defaults: Props): Resolved {
  if (typeof icon.body !== 'string') return { error: 'invalid-icon-body' };
  // the collection's own transformations merge with the icon's like a parent's (Iconify's mergeIconData)
  const props = overlay(defaults, icon, true);
  return props ? { props, body: icon.body, root: '' } : { error: 'invalid-icon-properties' };
}

type Parsed = {
  doc: Raw;
  prefix: string;
  namespace: string;
  icons: Map<string, Raw>;
  aliases: Map<string, Raw>;
  defaults: Props;
  categories: Map<string, string[]>;
  /** Direct alias names by parent. */
  children: Map<string, string[]>;
};

function parseJson(text: string): Raw | string {
  if (typeof text !== 'string' || text.length > MAX_CHARS) return 'collection exceeds 32 Mi characters or is not text';
  try {
    const doc: unknown = JSON.parse(text);
    return isRecord(doc) && isRecord(doc.icons) ? doc : 'collection requires an icons object';
  } catch {
    return 'collection is not valid JSON';
  }
}

function entriesOf(doc: Raw): { icons: Map<string, Raw>; aliases: Map<string, Raw> } | string {
  const rawAliases = doc.aliases ?? {};
  if (!isRecord(rawAliases)) return 'aliases must be an object';
  const icons = new Map(Object.entries(doc.icons as Raw));
  const aliases = new Map(Object.entries(rawAliases));
  if (icons.size === 0) return 'collection has no icons';
  if (icons.size + aliases.size > MAX_ENTRIES) return `collection exceeds ${MAX_ENTRIES} icons and aliases`;
  if ([...icons.values(), ...aliases.values()].some((v) => !isRecord(v))) return 'every icon and alias must be an object';
  return { icons: icons as Map<string, Raw>, aliases: aliases as Map<string, Raw> };
}

function parseCollection(text: string, options: IconifyImportOptions): Parsed | string {
  const doc = parseJson(text);
  if (typeof doc === 'string') return doc;
  const prefix = doc.prefix;
  if (typeof prefix !== 'string' || !PREFIX.test(prefix)) return 'collection requires a lower-case prefix';
  const namespace = options.namespace ?? prefix;
  if (!PREFIX.test(namespace)) return 'invalid target namespace';
  const entries = entriesOf(doc);
  if (typeof entries === 'string') return entries;
  const base: Props = { left: 0, top: 0, width: 16, height: 16, rotate: 0, hFlip: false, vFlip: false, hidden: false };
  const { left, top, width, height, rotate, hFlip, vFlip } = doc;
  const defaults = overlay(base, { left, top, width, height, rotate, hFlip, vFlip }, false);
  if (!defaults) return 'invalid collection default properties';
  const categories = categoriesOf(doc);
  if (!categories) return 'categories must map names to lists of icon names';
  return { doc, prefix, namespace, ...entries, defaults, categories, children: childrenOf(entries.aliases) };
}

function childrenOf(aliases: ReadonlyMap<string, Raw>): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const [name, alias] of aliases) if (typeof alias.parent === 'string') children.set(alias.parent, [...(children.get(alias.parent) ?? []), name]);
  return children;
}

/** Search words: categories, the alias chain's root and parent, and the names of direct aliases. */
function keywordsOf(parsed: Parsed, name: string, root: string, parent: string | undefined): string[] {
  const words = [...(parsed.categories.get(name) ?? parsed.categories.get(root) ?? []), ...(parsed.children.get(name) ?? [])];
  if (parent !== undefined) words.push(parent, root);
  return [...new Set(words)].sort(byCodeUnit);
}

type Entry = { readonly name: string; readonly alias: boolean };
type Context = { readonly parsed: Parsed; readonly options: Omit<IconifyImportOptions, 'namespace'>; readonly budget: { left: number } };

function refusal(context: Context, entry: Entry, hidden: boolean, diagnostics: readonly Diagnostic[]): IconifyIconOutcome {
  const raw = (entry.alias ? context.parsed.aliases : context.parsed.icons).get(entry.name) as Raw;
  const parent = entry.alias && typeof raw.parent === 'string' ? { parent: raw.parent } : {};
  return { name: entry.name, id: `${context.parsed.namespace}:${entry.name}`, ...parent, hidden, status: 'refused', diagnostics };
}

function resolveEntry(parsed: Parsed, entry: Entry): Resolved {
  const id = `${parsed.namespace}:${entry.name}`;
  if (!qualifiedNameSchema.safeParse(id).success) return { error: 'invalid icon name for a qualified definition ID' };
  if (!entry.alias) return resolveIcon(parsed.icons.get(entry.name) as Raw, parsed.defaults);
  if (parsed.icons.has(entry.name)) return { error: 'alias duplicates an icon name' };
  return resolveAlias(entry.name, parsed.icons, parsed.aliases, parsed.defaults);
}

async function convert(context: Context, entry: Entry): Promise<IconifyIconOutcome> {
  const { parsed, options } = context;
  const { name } = entry;
  const raw = (entry.alias ? parsed.aliases : parsed.icons).get(name) as Raw;
  const resolved = resolveEntry(parsed, entry);
  if ('error' in resolved) return refusal(context, entry, raw.hidden === true, [problem(resolved.error, `/${entry.alias ? 'aliases' : 'icons'}/${name}`)]);
  const { props } = resolved;
  const id = `${parsed.namespace}:${name}`;
  const svg = svgOf(resolved.body, props);
  if (svg.length > context.budget.left)
    return refusal(context, entry, props.hidden, [problem(`collection-work-limit: more than ${MAX_WORK_CHARS} SVG characters converted`)]);
  context.budget.left -= svg.length;
  const converted = await importSvgShape(svg, { ...options, id });
  if (!converted.ok) return refusal(context, entry, props.hidden, converted.error);
  const root = resolved.root || name;
  const parent = entry.alias ? (raw.parent as string) : undefined;
  const category = (parsed.categories.get(name) ?? parsed.categories.get(root))?.[0];
  const keywords = keywordsOf(parsed, name, root, parent);
  const definition = parseShapeDef({ ...converted.value.definition, keywords, ...(category === undefined ? {} : { category }) });
  if (!definition.ok) return refusal(context, entry, props.hidden, definition.error);
  return {
    name,
    id,
    ...(parent === undefined ? {} : { parent }),
    hidden: props.hidden,
    status: 'accepted',
    value: { ...converted.value, definition: definition.value },
  };
}

/**
 * Convert an Iconify JSON collection: resolve defaults, icon viewports, rotations/flips and bounded
 * alias chains, then convert every entry through the witnessed single-SVG path. Every icon and alias
 * gets an outcome; hidden entries are retained and flagged. Nothing is fetched. Not pack distribution.
 * @public
 */
export async function importIconifyCollection(text: string, options: IconifyImportOptions): Promise<IconifyImportReport> {
  const parsed = parseCollection(text, options);
  if (typeof parsed === 'string') return failed(parsed);
  const { namespace: _, ...rest } = options;
  const context: Context = { parsed, options: rest, budget: { left: MAX_WORK_CHARS } };
  const entries: IconifyIconOutcome[] = [];
  for (const name of [...parsed.icons.keys()].sort(byCodeUnit)) entries.push(await convert(context, { name, alias: false }));
  for (const name of [...parsed.aliases.keys()].sort(byCodeUnit)) entries.push(await convert(context, { name, alias: true }));
  return {
    status: 'processed',
    provenance: provenanceOf(parsed.doc, parsed.prefix, text),
    iconCount: parsed.icons.size,
    aliasCount: parsed.aliases.size,
    acceptedCount: entries.filter((e) => e.status === 'accepted').length,
    entries,
  };
}
