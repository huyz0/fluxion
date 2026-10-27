// Public entry of @fluxion/pack-icons-lucide; the package comment is the dts banner in tsdown.config.ts.
import { type DeclarativeShapePack, definePack, type Pack, type ShapeDef } from '@fluxion/sdk';
import generated from './icons.json' with { type: 'json' };

/**
 * Version of this package; also the version of its declarative distribution in `pack/`.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/** What `scripts/packs/lucide.mjs` writes: the curated subset converted by the Iconify importer, with the upstream notices. */
type GeneratedIcons = {
  /** SHA-256 of the pinned Iconify collection file the icons were converted from. */
  readonly sourceSha256: string;
  /** The upstream notice's Lucide (ISC) and Feather (MIT) parts, verbatim. */
  readonly notices: { readonly lucide: string; readonly feather: string };
  /** Icon names the notice lists as derived from Feather, resolved to their current Lucide names. */
  readonly feather: readonly string[];
  /** Each icon's Lucide name, library category and converted definition, in library order. */
  readonly icons: readonly { readonly name: string; readonly category: string; readonly definition: ShapeDef }[];
};
const { sourceSha256, notices, feather, icons } = generated as unknown as GeneratedIcons;

/** The pinned upstream collection (specs/import/corpus/manifest.json, source `iconify-lucide`). */
const UPSTREAM = {
  kind: 'upstream',
  reference: 'iconify:lucide',
  sha256: sourceSha256,
  revision: 'iconify/icon-sets@db4c0e1c75f933ae45c4484cd02ee3781a789363',
} as const;
/** `circle-question-mark` → `Circle question mark`. */
const displayName = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1).replaceAll('-', ' ')}`;
const shapes: readonly ShapeDef[] = icons.map(({ category, definition }) => ({ ...definition, category }));

/**
 * The Lucide icon pack's declarative source (ADR-0194): a curated subset of the pinned Lucide collection converted by the Iconify
 * importer (M18.101), credited to Lucide (ISC) and, for the icons Lucide lists as Feather-derived, to Feather (MIT).
 *
 * @public
 */
export const iconsLucideSource: DeclarativeShapePack = {
  id: 'lucide',
  version: VERSION,
  name: 'Lucide icons',
  license: 'ISC AND MIT',
  attribution: 'Lucide Icons and Contributors; Feather-derived icons by Cole Bemis',
  credits: [
    { id: 'lucide', license: 'ISC', attribution: 'Lucide Icons and Contributors', notice: notices.lucide, source: UPSTREAM },
    {
      id: 'feather',
      license: 'MIT',
      attribution: 'Cole Bemis (Feather)',
      notice: notices.feather,
      source: UPSTREAM,
      definitionIds: feather.map((name) => `lucide:${name}` as const),
    },
  ],
  definitions: icons.map(({ name }, i) => ({ name: displayName(name), def: shapes[i] as ShapeDef })),
};

/**
 * The Lucide icons, namespace `lucide`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const iconsLucidePack: Pack = definePack({ id: 'lucide', shapes });
