// A React view of a core signal (04 §2.3: one signal per record, components subscribe to the smallest
// value they render). Server rendering reads the signal once; the browser re-renders when it changes.
import { effect, type ReadSignal } from '@fluxion/core';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * The current value of `signal`, re-rendering the component when it changes.
 *
 * @public
 */
export function useValue<T>(signal: ReadSignal<T>): T {
  const subscribe = useCallback(
    (notify: () => void) =>
      effect(() => {
        signal();
        notify();
      }),
    [signal],
  );
  return useSyncExternalStore(subscribe, signal, signal);
}
