// The record diff two writers share (M12.49, M12.22 review F5): the stream of FluxScript into the document and the Source view's apply both turn a
// wanted set of records into the `puts` and `deletes` of one `document.applyRecords`. Pure.
import type { AnyRecord } from '@fluxion/schema';

/** Records by id. */
export type RecordsById = { readonly [id: string]: AnyRecord };

/** Whether two values are the same JSON. */
export const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * What turns `prev` into `next`.
 *
 * @param prev - the records as they are
 * @param next - the records as they are wanted
 * @returns `puts`: the records of `next` that are new or differ; `gone`: the ids of `prev` that `next` lacks. No id is in both.
 */
export function diffRecords(prev: RecordsById, next: RecordsById): { readonly puts: AnyRecord[]; readonly gone: string[] } {
  const puts = Object.values(next).filter((record) => !sameValue(prev[record.id], record));
  const gone = Object.keys(prev).filter((id) => !(id in next));
  return { puts, gone };
}
