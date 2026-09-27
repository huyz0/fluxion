// Document resources (02-document-model §2): `asset` (bytes live in the container), `theme`
// (DTCG token tree; the theme package interprets it in M9) and `plugin-ref` (lockfile of plugins).
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { RecordId } from '../ids.js';
import { type Extensible, type Meta, metaSchema, recordIdSchema } from '../primitives.js';

/**
 * A binary asset (image, font, …); the record holds metadata, the file container holds bytes.
 *
 * @public
 */
export type AssetRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'asset';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** SHA-256 of the bytes, 64 lower-case hex digits. */
  readonly hash: string;
  /** Media type, e.g. `image/png`. */
  readonly mime: string;
  /** Size in bytes. */
  readonly size: number;
  /** Original file name. */
  readonly name: string;
  /** Pixel width of an image. */
  readonly w?: number;
  /** Pixel height of an image. */
  readonly h?: number;
  /** URL of an external (not embedded) asset. */
  readonly source?: string;
}>;

/**
 * A theme: a DTCG design-token tree plus per-kind default styles (interpreted by `@fluxion/theme`).
 *
 * @public
 */
export type ThemeRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'theme';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** Theme name. */
  readonly name: string;
  /** DTCG token tree. */
  readonly tokens: { readonly [key: string]: unknown };
  /** Default styles by element kind and variant. */
  readonly defaults?: { readonly [key: string]: unknown };
}>;

/**
 * A plugin the document uses, pinned by version and integrity.
 *
 * @public
 */
export type PluginRefRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'plugin-ref';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** Plugin id, the namespace of its kinds (`acme`). */
  readonly pluginId: string;
  /** Exact semver version. */
  readonly version: string;
  /** Subresource-integrity hash of the plugin bundle (`sha384-…`). */
  readonly integrity?: string;
  /** How the plugin runs: in the page (`trusted`) or in the iframe sandbox (ADR-0007). */
  readonly trust: 'trusted' | 'sandboxed';
}>;

const tree = z.record(z.string(), z.unknown());
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Schema of the `asset` record. */
export const assetRecordSchema: z.ZodType<AssetRecord> = checkedSchema<AssetRecord>()(
  z.looseObject({
    id: recordIdSchema,
    type: z.literal('asset'),
    meta: metaSchema.optional(),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'expected a SHA-256 hash: 64 lower-case hex digits'),
    mime: z.string().regex(/^[a-z]+\/[0-9A-Za-z.+-]+$/, 'expected a media type such as image/png'),
    size: z.number().int().min(0),
    name: z.string(),
    w: z.number().int().positive().optional(),
    h: z.number().int().positive().optional(),
    source: z.url({ protocol: /^https?$/ }).optional(),
  }),
);

/** Schema of the `theme` record. */
export const themeRecordSchema: z.ZodType<ThemeRecord> = checkedSchema<ThemeRecord>()(
  z.looseObject({ id: recordIdSchema, type: z.literal('theme'), meta: metaSchema.optional(), name: z.string(), tokens: tree, defaults: tree.optional() }),
);

/** Schema of the `plugin-ref` record. */
export const pluginRefRecordSchema: z.ZodType<PluginRefRecord> = checkedSchema<PluginRefRecord>()(
  z.looseObject({
    id: recordIdSchema,
    type: z.literal('plugin-ref'),
    meta: metaSchema.optional(),
    pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().regex(SEMVER, 'expected an exact semver version'),
    integrity: z
      .string()
      .regex(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
    trust: z.enum(['trusted', 'sandboxed']),
  }),
);

/**
 * A document resource record.
 *
 * @public
 */
export type ResourceRecord = AssetRecord | ThemeRecord | PluginRefRecord;
