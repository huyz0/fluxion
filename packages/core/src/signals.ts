// The one place core touches alien-signals (ADR-0002; M3 plan risk "API churn"): a tiny facade, so
// the library can change or be replaced without touching the store.
import { computed as alienComputed, effect as alienEffect, signal as alienSignal, endBatch, startBatch } from 'alien-signals';

/**
 * A reactive value: call it to read; reading inside {@link effect} or {@link computed} subscribes.
 *
 * @public
 */
export type ReadSignal<T> = () => T;

/**
 * A derived, memoized reactive value.
 *
 * @public
 */
export function computed<T>(fn: () => T): ReadSignal<T> {
  return alienComputed(() => fn());
}

/**
 * Run `fn` now and again whenever a signal it read changes; returns a function that stops it.
 *
 * @public
 */
export function effect(fn: () => void): () => void {
  return alienEffect(fn);
}

/**
 * Run `fn` with notifications held until it returns, so dependents see every change at once.
 *
 * @public
 */
export function batch(fn: () => void): void {
  startBatch();
  try {
    fn();
  } finally {
    endBatch();
  }
}

/**
 * A writable signal. The store's own records are written only through transactions; editor session
 * state (selection, camera, tool, hover) is plain writable signals (ADR-0028).
 *
 * @public
 */
export type WritableSignal<T> = {
  /** Read the value (subscribing, inside {@link effect} or {@link computed}). */
  readonly get: ReadSignal<T>;
  /** Replace the value; the same value again does not notify. */
  set(value: T): void;
};

/**
 * A writable signal holding `initial`; setting an identical value does not notify.
 *
 * @public
 */
export function writable<T>(initial: T): WritableSignal<T> {
  const s = alienSignal(initial);
  return { get: () => s(), set: (value) => s(value) };
}
