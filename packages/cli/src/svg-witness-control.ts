export type WitnessFailureKind = 'deadline' | 'cancelled' | 'cleanup' | 'transport' | 'busy' | 'disposed';
export type ControlledResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: WitnessFailureKind };
export type WitnessControl = {
  readonly alive: () => boolean;
  readonly run: <T>(work: () => Promise<T>, budget?: number) => Promise<ControlledResult<T>>;
  readonly dispose: () => Promise<boolean>;
};
/** Native host lifetime includes a two-second cleanup reserve; all continuations consult alive. */
export function controlWitness(cleanup: { readonly close: () => Promise<boolean> }, signal?: AbortSignal): WitnessControl {
  let reason: WitnessFailureKind | undefined;
  let closing: Promise<boolean> | undefined;
  let busy = false;
  let stop = () => {};
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const close = (kind: WitnessFailureKind): Promise<boolean> => {
    if (closing) return closing;
    reason = kind;
    clearTimeout(lifetime);
    signal?.removeEventListener('abort', abort);
    closing = cleanup.close();
    stop();
    return closing;
  };
  const abort = () => {
    void close('cancelled');
  };
  const lifetime = setTimeout(() => {
    void close('deadline');
  }, 118000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const failure = async (): Promise<ControlledResult<never>> => ({ ok: false, kind: (await closing) ? (reason ?? 'disposed') : 'cleanup' });
  const run = async <T>(work: () => Promise<T>, budget = 10000): Promise<ControlledResult<T>> => {
    if (reason) return failure();
    if (busy) return { ok: false, kind: 'busy' };
    busy = true;
    const deadline = setTimeout(
      () => {
        void close('deadline');
      },
      Math.min(budget, 118000),
    );
    try {
      const value = await Promise.race([
        Promise.resolve()
          .then(() => {
            if (reason) throw Error('closed witness');
            return work();
          })
          .then((result) => ({ ok: true as const, value: result })),
        stopped.then(() => ({ ok: false as const, kind: reason ?? ('disposed' as const) })),
      ]);
      return reason ? await failure() : value;
    } catch {
      await close('transport');
      return failure();
    } finally {
      clearTimeout(deadline);
      busy = false;
    }
  };
  return { alive: () => reason === undefined, run, dispose: () => close('disposed') };
}
