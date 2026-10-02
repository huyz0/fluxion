// The assets of a pasted payload (ADR-0020, ADR-0150): which the document holds, which are made, which bytes are held.
import type { ReadView } from '@fluxion/core';
import { sanitizeSvg } from '@fluxion/format';
import type { AssetRecord, RecordId } from '@fluxion/schema';
import type { AssetStore } from './asset-store.js';
import type { Execute } from './pointer.js';

/**
 * An asset a copied element uses: its record, and its bytes as a `data:` URL when the host holds them and they are 1 MB
 * or less (a larger one travels by hash only, ADR-0020).
 *
 * @public
 */
export type ClipboardAsset = AssetRecord & {
  /** The bytes as a `data:` URL. */
  readonly dataUrl?: string;
};

/** What planning and making a payload's assets need of the paste deps. */
export type AssetDeps = {
  readonly view: ReadView;
  readonly execute: Execute;
  readonly newId: () => RecordId;
  readonly assets?: AssetStore | undefined;
};

/** `dataUrl` as it may be held: an SVG is sanitised again whatever the sender did (a payload is untrusted); undefined when it is no SVG. */
function cleanDataUrl(dataUrl: string): string | undefined {
  if (!/^data:image\/svg\+xml/i.test(dataUrl)) return dataUrl;
  const comma = dataUrl.indexOf(',');
  const body = dataUrl.slice(comma + 1);
  let text: string;
  try {
    text = /;base64/i.test(dataUrl.slice(0, comma)) ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
  } catch {
    return undefined;
  }
  const clean = sanitizeSvg(text);
  if (clean === undefined) return undefined;
  const bytes = new TextEncoder().encode(clean);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** What pasting a payload's assets takes: the asset of the document each is pasted as, the records to make, and bytes to hold. */
export type AssetPlan = {
  /** For each source asset id, the id it has in the document (held already, or about to be made). */
  readonly ids: ReadonlyMap<string, RecordId>;
  /** The asset records to make, with their bytes. */
  readonly make: readonly { readonly record: AssetRecord; readonly dataUrl: string }[];
  /** Bytes to hold for assets the document has the records of but the editor not the bytes. */
  readonly fill: readonly { readonly id: RecordId; readonly dataUrl: string }[];
};

/**
 * For each asset of `payload`, the asset of the document it is pasted as: the one the document already holds with the
 * same bytes (hash), else a new asset record (with its bytes) where the payload carried them. An asset that came without
 * bytes and is not held is not planned, and validation reports an image of it missing (ADR-0020). Nothing is written.
 */
export function planAssets(deps: AssetDeps, payload: { readonly assets: readonly ClipboardAsset[] }): AssetPlan {
  const held = new Map(deps.view.members('byType', 'asset').map((id) => [(deps.view.get(id) as AssetRecord).hash, id] as const));
  const ids = new Map<string, RecordId>();
  const make: { record: AssetRecord; dataUrl: string }[] = [];
  const fill: { id: RecordId; dataUrl: string }[] = [];
  for (const { dataUrl: sent, ...record } of payload.assets) {
    const bytes = sent === undefined ? undefined : cleanDataUrl(sent);
    const same = held.get(record.hash);
    if (same !== undefined) {
      ids.set(record.id, same);
      if (bytes !== undefined && deps.assets !== undefined && deps.assets.url(same) === undefined) fill.push({ id: same, dataUrl: bytes });
    } else if (bytes !== undefined && deps.assets !== undefined) {
      const id = deps.newId();
      ids.set(record.id, id);
      make.push({ record: { ...record, id }, dataUrl: bytes });
    }
  }
  return { ids, make, fill };
}

/** Make the planned asset records (one undo step with the paste, by `mergeKey`) and hold their bytes. */
export function makeAssets(deps: AssetDeps, plan: AssetPlan, mergeKey: string): void {
  for (const m of plan.make) if (deps.execute('asset.create', { asset: m.record }, { mergeKey }).ok) deps.assets?.set(m.record.id, m.dataUrl);
  for (const f of plan.fill) deps.assets?.set(f.id, f.dataUrl);
}
