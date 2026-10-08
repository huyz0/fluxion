// The decompiler (06-ai-authoring.md §3.1, ADR-0030, ADR-0031, ADR-0032, FR-DSL-002): a document back to FluxScript that compiles to the
// same document. The header is the title, the theme (its name, and as overrides the token values that differ from the registered theme of
// that name), the packs of the shapes used and the deferred top-level sections; then each screen's block (screen.ts). The id salt stays in
// the document and a recompile into it reads it (ADR-0031), so ids are stable. Records outside the v0 subset are counted and named in
// `# kept:` comments, never written.
import { type CoreRegistries, sha256Hash128 } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { isToken, LIGHT_THEME, type Theme, type Token, type TokenGroup, themeOf } from '@fluxion/theme';
import type { DecompileOptions, DecompileResult } from '../types.js';
import { type Ctx, contextOf, type Rec } from './context.js';
import { blockLines, itemText, type Out } from './emit.js';
import { screenOut } from './screen.js';

type Entry = readonly [string, Out];

/** A registered theme by name or registry key. */
function registered(registries: CoreRegistries, name: string): Theme | undefined {
  for (const [id, value] of registries.themes.list()) {
    const t = themeOf(value);
    if (t && (t.name === name || id === name)) return t;
  }
  return undefined;
}

/** A token value as an override writes it (the inverse of expand's `overrideValue`), or undefined when an override cannot say it. */
function overrideOut(t: Token): string | number | undefined {
  const v = t.$value as unknown;
  if (typeof v === 'string' || typeof v === 'number') return v;
  const unit = t.$type === 'dimension' ? 'px' : t.$type === 'duration' ? 'ms' : undefined;
  const u = v as { readonly value?: unknown; readonly unit?: unknown } | null;
  return unit !== undefined && typeof u?.value === 'number' && u.unit === unit ? u.value : undefined;
}

/** The tokens of `tokens` whose value differs from `base`'s, as overrides by dot path. */
function overrides(tokens: TokenGroup, base: TokenGroup, prefix = ''): Entry[] {
  return Object.entries(tokens).flatMap(([name, node]): Entry[] => {
    const path = prefix ? `${prefix}.${name}` : name;
    const other = (base as { readonly [k: string]: unknown })[name];
    if (typeof node !== 'object' || node === null || typeof other !== 'object' || other === null) return [];
    if (!isToken(node)) return overrides(node as TokenGroup, other as TokenGroup, path);
    const t = node as Token;
    if (!isToken(other as TokenGroup) || JSON.stringify(t.$value) === JSON.stringify((other as Token).$value)) return [];
    const v = overrideOut(t);
    return v === undefined ? [] : [[path, v]];
  });
}

/** The document's theme record. */
function themeRecord(ctx: Ctx): { readonly name?: string; readonly tokens?: TokenGroup } {
  const rec = ctx.meta && (ctx.doc.records[ctx.meta['themeId'] as RecordId] as Rec | undefined);
  const name = rec?.['name'];
  return { ...(typeof name === 'string' ? { name } : {}), ...(rec?.['tokens'] ? { tokens: rec['tokens'] as TokenGroup } : {}) };
}

/** The overrides of a theme record over the theme of its name, and whether the file names it. */
function themeOverrides(ctx: Ctx, name: string, tokens: TokenGroup | undefined): { readonly changed: Entry[]; readonly named: boolean } {
  const found = registered(ctx.registries, name);
  const base = found ?? (name === LIGHT_THEME.name ? LIGHT_THEME : undefined);
  const changed = base && tokens ? overrides(tokens, base.tokens) : [];
  // the built-in light theme is the default: a file names it only when the registered `light` is another theme
  const named = name !== LIGHT_THEME.name || (found !== undefined && overrides(found.tokens, LIGHT_THEME.tokens).length > 0);
  return { changed, named };
}

/** `theme:`: the name alone, or `{ preset, overrides, …deferred }`; nothing for the built-in light theme with nothing to add. */
function themeEntry(ctx: Ctx): Entry[] {
  const { name, tokens } = themeRecord(ctx);
  const deferred: Entry[] = ctx.deferred.flatMap(([p, t]) => (p.startsWith('/theme/') ? [[p.slice('/theme/'.length), { raw: t }] as const] : []));
  const { changed, named } = name === undefined ? { changed: [], named: false } : themeOverrides(ctx, name, tokens);
  if (changed.length === 0 && deferred.length === 0) return named && name !== undefined ? [['theme', name]] : [];
  const map: Entry[] = [
    ...(named && name !== undefined ? ([['preset', name]] as const) : []),
    ...(changed.length > 0 ? ([['overrides', { map: changed, flow: true }]] as const) : []),
    ...deferred,
  ];
  return [['theme', { map, flow: true }]];
}

/** Records of no screen block: not the document, its theme, a screen, an element of a screen, or a binding. */
function keptRecords(ctx: Ctx): number {
  const themeId = ctx.meta?.['themeId'];
  const onScreen = new Set([...ctx.elements.values()].flatMap((els) => els.map((el) => el.id)));
  const written = (r: Rec) => r === ctx.meta || r.id === themeId || r.type === 'screen' || r.type === 'binding' || onScreen.has(r.id);
  return (Object.values(ctx.doc.records) as Rec[]).filter((r) => !written(r)).length;
}

const keptComment = (n: number) => (n > 0 ? [`kept: ${n} records not shown`] : []);

function header(ctx: Ctx): Entry[] {
  const title = ctx.meta?.['title'];
  const top: Entry[] = ctx.deferred.flatMap(([p, t]) => (/^\/[^/]+$/.test(p) ? [[p.slice(1), { raw: t }] as const] : []));
  return [
    ['flux', 1],
    ['title', typeof title === 'string' ? title : ''],
    ...themeEntry(ctx),
    ...(ctx.uses.length > 0 ? ([['uses', { seq: ctx.uses, flow: true }]] as const) : []),
    ...top,
  ];
}

/**
 * Decompile a document to FluxScript (FR-DSL-002): a `flux: 1` file that compiles back to the same document, for the records of the v0
 * subset (nodes, groups, edges, pins; ADR-0032). Deferred sections are written back in place (ADR-0031). An element without a slug gets
 * one made from its label, unique in the document. Records outside the subset are not written: each screen block, and the file, ends with
 * `# kept: N records not shown`. Deterministic: the same document and registries give the same text.
 *
 * @param doc - the document
 * @param options - registries, the id hash, and the screens to write
 * @returns the text, the count of records it leaves out, and the slug of each node and group
 * @public
 */
export function decompile(doc: DocumentFile, options: DecompileOptions): DecompileResult {
  const ctx = contextOf(doc, options.registries, options.hasher ?? sha256Hash128);
  const only = options.screens ? new Set(options.screens) : undefined;
  const screens = ctx.screens.filter((s) => only === undefined || only.has(s.id)).map((s) => screenOut(ctx, s));
  const outside = keptRecords(ctx);
  const map: Entry[] = [...header(ctx), ['screens', { seq: screens.map((s) => s.out) }]];
  const text = `${blockLines({ map, comments: keptComment(outside) }, 0).join('\n')}\n`;
  return { text, kept: outside + screens.reduce((n, s) => n + s.kept, 0), slugs: ctx.slugs };
}

/**
 * Decompile one screen of a document (the Source view's scope, ADR-0032): its item of `screens:` (`- id: …`), at indent 0, with its
 * `# kept:` comment. Empty text for an id that is no screen of the document.
 *
 * @param doc - the document
 * @param screenId - the screen's record id
 * @param options - registries and the id hash (`screens` is ignored)
 * @returns the screen's text, the count of its elements it leaves out, and the slug of each node and group of the document
 * @public
 */
export function decompileScreen(doc: DocumentFile, screenId: RecordId, options: DecompileOptions): DecompileResult {
  const ctx = contextOf(doc, options.registries, options.hasher ?? sha256Hash128);
  const s = ctx.screens.find((x) => x.id === screenId);
  if (!s) return { text: '', kept: 0, slugs: ctx.slugs };
  const { out, kept } = screenOut(ctx, s);
  return { text: itemText(out, 0), kept, slugs: ctx.slugs };
}
