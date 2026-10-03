// Theme and metadata commands (FR-THM-004, FR-DOC-006, M9.9, ADR-0152): the chosen theme is copied into the document as a
// `theme-<slug>` record (never overwritten), the document or one screen points at it, and a metadata edit stamps `modified`
// with the time the host read from its Clock port (core draws no time of its own). Each is one transaction, so one undo step.
import type { RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from './command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from './commands.js';
import type { Tx } from './transaction.js';

/** The longest slug: `theme-` and it fit the 64 characters of a record id. */
const SLUG_MAX = 58;

/**
 * The record id a pack theme named `name` is copied under: `theme-<slug>`, the slug being `name` lower-cased with each run of
 * characters outside `a-z0-9` turned into `-` (ADR-0152).
 *
 * @public
 */
export function themeRecordId(name: string): string {
  return `theme-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)}`;
}

const tree = z.record(z.string(), z.unknown());
const themeArg = z.object({ name: z.string().min(1), tokens: tree, defaults: tree.optional() });
type ThemeArg = z.infer<typeof themeArg>;

/** The id `theme` is stored under, written first unless a record holds that id already (it is then used as it is). */
function adopt(tx: Tx, theme: ThemeArg): RecordId {
  const themeId = themeRecordId(theme.name) as RecordId;
  if (tx.get(themeId) === undefined)
    tx.put({ id: themeId, type: 'theme', name: theme.name, tokens: theme.tokens, ...(theme.defaults ? { defaults: theme.defaults } : {}) });
  return themeId;
}

/** The refusal when the id a theme would take belongs to a record that is not a theme, else null. */
function clash(ctx: CommandContext, command: string, theme: ThemeArg, at: ReadonlyArray<string>) {
  const existing = ctx.store.get(themeRecordId(theme.name) as RecordId);
  return existing !== undefined && existing.type !== 'theme' ? refuse(command, at, `"${existing.id}" is a ${existing.type}, not a theme`) : null;
}

/** The document singleton's id ('' when the store has none: refused by the id check). */
const documentId = (ctx: CommandContext): string => ctx.store.members('byType', 'document')[0] ?? '';

const metaFields = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  lang: z.string().optional(),
  authors: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  custom: z.record(z.string(), z.string()).optional(),
});

/** The theme and metadata commands. */
export const THEME_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'document.setTheme',
    title: title('document.setTheme', 'Set theme'),
    args: z.object({ theme: themeArg }),
    run: (ctx, args) =>
      checkIds(ctx, 'document.setTheme', 'document', [[[], documentId(ctx)]]) ??
      clash(ctx, 'document.setTheme', args.theme, ['theme', 'name']) ??
      write(ctx, 'document.setTheme', (tx) => tx.patch(documentId(ctx) as RecordId, { themeId: adopt(tx, args.theme) })),
  }),
  defineCommand({
    id: 'screen.setThemeOverride',
    title: title('screen.setThemeOverride', 'Set screen theme'),
    // no theme: the override is removed and the screen follows the document's theme again
    args: z.object({ id, theme: themeArg.optional() }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'screen.setThemeOverride', 'screen', [[['id'], args.id]]);
      if (bad) return bad;
      const theme = args.theme;
      if (theme === undefined) return write(ctx, 'screen.setThemeOverride', (tx) => tx.patch(args.id as RecordId, { themeId: undefined }));
      return (
        clash(ctx, 'screen.setThemeOverride', theme, ['theme', 'name']) ??
        write(ctx, 'screen.setThemeOverride', (tx) => tx.patch(args.id as RecordId, { themeId: adopt(tx, theme) }))
      );
    },
  }),
  defineCommand({
    id: 'document.updateMeta',
    title: title('document.updateMeta', 'Change document details'),
    // `modified` is the host's Clock reading as ISO 8601; core never reads time itself
    args: z.object({ fields: metaFields, modified: z.iso.datetime({ offset: true }) }),
    run: (ctx, args) =>
      checkIds(ctx, 'document.updateMeta', 'document', [[[], documentId(ctx)]]) ??
      write(ctx, 'document.updateMeta', (tx) => tx.patch(documentId(ctx) as RecordId, { ...args.fields, modified: args.modified })),
  }),
];
