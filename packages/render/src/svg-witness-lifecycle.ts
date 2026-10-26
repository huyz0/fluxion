import { parseSvgPaintRequest, type SvgPaintReceipt, type SvgPaintRequest, type SvgPaintWitness } from '@fluxion/format';

export type WitnessScope = {
  readonly alive: () => boolean;
  readonly own: (cleanup: () => void) => void;
};
export type WitnessSession = { readonly witness: SvgPaintWitness; readonly dispose: () => void };
type Observe = (request: SvgPaintRequest, scope: WitnessScope) => Promise<SvgPaintReceipt>;
const refused = (identity = ''): SvgPaintReceipt => ({ identity, status: 'unsupported', fontHashes: [] });
function observed(scope: WitnessScope, result: SvgPaintReceipt, identity: string): SvgPaintReceipt {
  return scope.alive() && result.identity === identity ? result : refused(identity);
}
function release(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    /* A failed disposer cannot prevent remaining owned resources from closing. */
  }
}

/** Internal lifecycle: all effect continuations must check scope.alive before allocating or publishing. */
export function ownWitness(observe: Observe, signal?: AbortSignal): WitnessSession {
  let closed = false;
  let count = 0;
  let active: (() => void) | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    clearTimeout(lifetime);
    signal?.removeEventListener('abort', dispose);
    active?.();
  };
  const lifetime = setTimeout(dispose, 120_000);
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  const witness: SvgPaintWitness = async (input) => {
    if (closed || active) return refused();
    const parsed = parseSvgPaintRequest(input);
    if (!parsed.ok) return refused();
    const request = parsed.value;
    count++;
    let live = true;
    const cleanups: (() => void)[] = [];
    let cancel: (receipt: SvgPaintReceipt) => void = () => {};
    const cancelled = new Promise<SvgPaintReceipt>((resolve) => {
      cancel = resolve;
    });
    const end = () => {
      if (!live) return;
      live = false;
      clearTimeout(deadline);
      for (const cleanup of cleanups.splice(0).reverse()) release(cleanup);
      cancel(refused(request.identity));
    };
    const deadline = setTimeout(dispose, 10_000);
    active = end;
    const scope: WitnessScope = {
      alive: () => live && !closed,
      own: (cleanup) => {
        if (scope.alive()) cleanups.push(cleanup);
        else release(cleanup);
      },
    };
    try {
      const result = await Promise.race([observe(request, scope), cancelled]);
      return observed(scope, result, request.identity);
    } catch {
      return refused(request.identity);
    } finally {
      end();
      active = undefined;
      if (count >= 128) dispose();
    }
  };
  return { witness, dispose };
}
