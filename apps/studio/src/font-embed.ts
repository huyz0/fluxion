// Embedding the bundled fonts a document uses when it is saved (FR-THM-008, NFR-SIZE-004, NFR-LIC-003, ADR-0022): the studio draws Inter, Source Serif 4 and
// JetBrains Mono from its own build, so a file that names one of them would draw in a fallback anywhere else. On save each bundled family the text
// uses becomes font asset records (with the face's recorded metrics, copyright and licence) and its files travel in the archive, whole, as an
// uploaded font does. A document with no theme record draws in the built-in theme's font (Inter), so that family counts as used.
import { type FluxAsset, usedFontFamilies } from '@fluxion/format';
import type { AnyRecord, AssetRecord, DocumentFile, RecordId } from '@fluxion/schema';

/**
 * A bundled face, with a way to read its file.
 *
 * @public
 */
export type BundledFace = {
  /** The family name. */
  readonly family: string;
  /** CSS weight. */
  readonly weight: number;
  /** CSS style. */
  readonly style: 'normal' | 'italic';
  /** The licence, as an SPDX id. */
  readonly license: string;
  /** The copyright line. */
  readonly copyright: string;
  /** The file's name. */
  readonly name: string;
  /** The recorded metrics of the face (ADR-0148). */
  readonly metrics: unknown;
  /** The file's bytes, or undefined where the build does not have it. */
  readonly bytes: () => Promise<Uint8Array | undefined>;
};

/**
 * What embedding needs.
 *
 * @public
 */
export type FontEmbedDeps = {
  /** Every bundled face. */
  readonly faces: readonly BundledFace[];
  /** A new record id. */
  readonly newId: () => RecordId;
  /** Hashes the files. */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
};

/** A family name as `usedFontFamilies` compares: trimmed, runs of whitespace as one space, lower case. */
const normalise = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The font the built-in theme draws text in when the document has no theme record. */
const BUILTIN_FAMILY = 'Inter';

/** `doc` with a theme record that says what the built-in theme says about fonts, so the families in use can be read. */
function withBuiltinTheme(doc: DocumentFile): DocumentFile {
  const theme = { id: '__builtin-theme', type: 'theme', name: 'built-in', tokens: {}, defaults: { font: { family: BUILTIN_FAMILY } } };
  const records = Object.fromEntries(
    Object.entries(doc.records).map(([id, r]) => [id, (r as { type?: string }).type === 'document' ? { ...r, themeId: theme.id } : r]),
  );
  return { ...doc, records: { ...records, [theme.id]: theme as unknown as AnyRecord } };
}

/** The families (normalised) of the font assets `doc` already holds. */
function embeddedFamilies(doc: DocumentFile): Set<string> {
  const out = new Set<string>();
  for (const r of Object.values(doc.records) as { type?: string; font?: { family?: unknown } }[]) {
    if (r.type === 'asset' && typeof r.font?.family === 'string') out.add(normalise(r.font.family));
  }
  return out;
}

/**
 * The font asset records and file bytes to add to `doc` for the bundled families its text uses and it does not already embed (every face of a used
 * family, as `usedFontFamilies` keeps them). A face whose file the build lacks is left out.
 *
 * @public
 */
export async function bundledFontsFor(
  doc: DocumentFile,
  deps: FontEmbedDeps,
): Promise<{ readonly records: readonly AssetRecord[]; readonly assets: ReadonlyMap<string, FluxAsset> }> {
  const used = usedFontFamilies(doc) ?? usedFontFamilies(withBuiltinTheme(doc)) ?? new Set<string>();
  const have = embeddedFamilies(doc);
  const records: AssetRecord[] = [];
  const assets = new Map<string, FluxAsset>();
  for (const face of deps.faces) {
    const family = normalise(face.family);
    if (!used.has(family) || have.has(family)) continue;
    const bytes = await face.bytes();
    if (bytes === undefined) continue;
    const hash = await deps.sha256(bytes);
    assets.set(hash, { bytes, mime: 'font/woff2' });
    records.push({
      id: deps.newId(),
      type: 'asset',
      hash,
      mime: 'font/woff2',
      size: bytes.byteLength,
      name: face.name,
      font: {
        family: face.family,
        weight: face.weight,
        style: face.style,
        source: 'bundled',
        license: face.license,
        copyright: face.copyright,
        metrics: face.metrics,
      },
    } as AssetRecord);
  }
  return { records, assets };
}
