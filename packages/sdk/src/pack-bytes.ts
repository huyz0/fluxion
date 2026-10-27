// Byte and JSON helpers shared by the shape pack loaders; not part of the package entry.
import type { Hasher } from '@fluxion/core';
import { type Diagnostic, jsonPointer } from '@fluxion/schema';

/** One pack diagnostic at a JSON-pointer path. */
export const problem = (path: readonly string[], message: string): readonly Diagnostic[] => [
  { code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(path), message },
];
/** An owned copy of host bytes within the cap, or undefined. */
export function snapshot(bytes: Uint8Array, maxBytes: number): Uint8Array | undefined {
  return bytes instanceof Uint8Array && bytes.byteLength <= maxBytes ? new Uint8Array(bytes) : undefined;
}
/** Deep-freeze plain parsed JSON in place. */
export function freezeJson<T>(value: T): T {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (typeof item !== 'object' || item === null || seen.has(item)) continue;
    seen.add(item);
    Object.freeze(item);
    for (const child of Object.values(item)) pending.push(child);
  }
  return value;
}
/** Strict UTF-8 JSON; throws on malformed input. */
export function decode(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
/** Host SHA-256 of a copy; throws on a malformed digest. */
export async function digest(bytes: Uint8Array, hasher: Hasher): Promise<string> {
  const hash = await hasher.sha256(new Uint8Array(bytes));
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid SHA-256 result');
  return hash;
}
