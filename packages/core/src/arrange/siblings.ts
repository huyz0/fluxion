// The z-ordered lists of siblings that grouping and z-order work on (FR-ARR-001, FR-ARR-004): the elements under
// one parent of a screen, back to front, and fractional index keys placed between neighbours.
import { compareKeys, err, keyBetween, ok, type RecordId, type Result } from '@fluxion/schema';
import type { CommandContext } from '../commands.js';

export type Box = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
};
export type El = {
  readonly id: RecordId;
  readonly kind: string;
  readonly screenId: RecordId;
  readonly parentId?: RecordId;
  readonly index: string;
  readonly transform?: Box;
};

export const element = (ctx: CommandContext, x: string): El => ctx.store.get(x as RecordId) as unknown as El;

/** The elements under `parentId` of `screenId` (the screen's top level when absent), in z-order. */
export function siblings(ctx: CommandContext, screenId: RecordId, parentId: RecordId | undefined): El[] {
  const ids =
    parentId === undefined
      ? ctx.store.members('byScreen', screenId).filter((x) => element(ctx, x).parentId === undefined)
      : ctx.store.members('byParent', parentId);
  return ids
    .map((x) => element(ctx, x))
    .filter((e) => e.index !== undefined)
    .sort((a, b) => compareKeys(a.index, b.index));
}

/** `count` index keys in order between `low` and the next key above it in `taken` (open above when none), or why not. */
export function keysAfter(low: string, taken: readonly string[], count: number): Result<string[], string> {
  const above = taken.find((k) => compareKeys(k, low) > 0) ?? null;
  const keys: string[] = [];
  let from: string = low;
  for (let i = 0; i < count; i += 1) {
    const key = keyBetween(from, above);
    if (!key.ok) return err(key.error.message);
    keys.push(key.value);
    from = key.value;
  }
  return ok(keys);
}
