// The asset manager's model (FR-AST-005, M10.16): the document's asset records as rows with what each costs the file and whether anything
// uses it, and which ones "Remove unused" would delete. Whether an asset is used is the same answer a save gives (`usedAssetIds`), so the
// panel never offers to remove what a save would write, and never keeps what a save would drop.
import { usedAssetIds } from '@fluxion/format';
import type { AnyRecord, DocumentFile } from '@fluxion/schema';

/**
 * One asset record as the manager lists it.
 *
 * @public
 */
export type AssetRow = {
  /** The asset record's id. */
  readonly id: string;
  /** The file name the record keeps. */
  readonly name: string;
  /** The media type. */
  readonly mime: string;
  /** The size in bytes the record keeps. */
  readonly size: number;
  /** Pixel width, when the record has one. */
  readonly width?: number;
  /** Pixel height, when the record has one. */
  readonly height?: number;
  /** True for a font. */
  readonly font: boolean;
  /** True when an element, a screen or the text uses it (what a save would write). */
  readonly used: boolean;
  /** This asset's share of all the assets' bytes, 0 to 1. */
  readonly share: number;
};

type AssetFields = AnyRecord & {
  readonly name?: unknown;
  readonly mime?: unknown;
  readonly size?: unknown;
  readonly w?: unknown;
  readonly h?: unknown;
  readonly font?: unknown;
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The asset records of `doc` as rows, the largest first (then by name), with each one's share of the total.
 *
 * @public
 */
export function assetRows(doc: DocumentFile): AssetRow[] {
  const used = usedAssetIds(doc);
  const records = (Object.values(doc.records) as AssetFields[]).filter((r) => r.type === 'asset');
  const total = records.reduce((sum, r) => sum + (num(r.size) ?? 0), 0);
  return records
    .map((r): AssetRow => {
      const [width, height] = [num(r.w), num(r.h)];
      return {
        id: r.id,
        name: typeof r.name === 'string' ? r.name : r.id,
        mime: typeof r.mime === 'string' ? r.mime : 'application/octet-stream',
        size: num(r.size) ?? 0,
        ...(width !== undefined && height !== undefined && { width, height }),
        font: r.font !== undefined,
        used: used.has(r.id),
        share: total === 0 ? 0 : (num(r.size) ?? 0) / total,
      };
    })
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/**
 * The ids "Remove unused" deletes: the rows nothing uses.
 *
 * @public
 */
export const unusedAssetIds = (rows: readonly AssetRow[]): string[] => rows.filter((r) => !r.used).map((r) => r.id);

/**
 * A byte count for people: bytes below 1 kB, then kB and MB with one decimal.
 *
 * @public
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
