// ADR-0175: only the caller resolves routed geometry; core copies plain finite points.
import { type BindingRecord, ok, type Point, type RecordId, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { refuse } from '../command-helpers.js';
import type { ReadView } from '../store.js';
import type { TxFailure } from '../transaction.js';

const point: z.ZodType<Point> = z.object({ x: z.number().finite(), y: z.number().finite() });
type SuppliedEnds = Record<string, { readonly source?: Point | undefined; readonly target?: Point | undefined }>;
export const duplicateEndsSchema: z.ZodType<SuppliedEnds> = z.record(z.string(), z.object({ source: point.optional(), target: point.optional() }));
type FreeEnds = { readonly freeSource?: Point; readonly freeTarget?: Point };
const FREE_FIELD = { source: 'freeSource', target: 'freeTarget' } as const;

/** Preflight every omitted binding before the duplicate writes any record. */
export function duplicateFreeEnds(
  view: ReadView,
  screen: RecordId,
  copied: readonly RecordId[],
  supplied: SuppliedEnds | undefined,
): Result<ReadonlyMap<RecordId, FreeEnds>, TxFailure> {
  const selected = new Set(copied);
  const result = new Map<RecordId, FreeEnds>();
  for (const id of view.members('byScreen', screen)) {
    for (const bindingId of view.members('bindingsByElement', id)) {
      const binding = view.get(bindingId) as BindingRecord;
      if (binding.connectorId !== id || selected.has(bindingId)) continue;
      const at = supplied?.[id]?.[binding.end];
      if (at === undefined) return refuse('screen.duplicate', ['freeEnds', id, binding.end], 'an omitted binding requires its resolved endpoint point');
      result.set(id, { ...result.get(id), [FREE_FIELD[binding.end]]: at });
    }
  }
  return ok(result);
}
