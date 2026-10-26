/** Bounded transport only: the shared browser entry still validates theme/face semantics. */
export type EncodedWitnessFont = {
  readonly family: string;
  readonly weight: 400;
  readonly style: 'normal';
  readonly sha256: string;
  readonly profile: 'inter-latin-400-ascii';
  readonly base64: string;
};
export type PreparedWitnessInput = {
  readonly theme: unknown;
  readonly fonts: readonly EncodedWitnessFont[];
  readonly encodedBytes: number;
};
type Bound = { nodes: number; chars: number; seen: Set<object> };
function countText(value: string, bound: Bound): string {
  bound.chars += value.length;
  if (bound.chars > 262144) throw Error('theme text');
  return value;
}
function checkArraySlots(input: object): void {
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isInteger(length) || length < 0 || length > 4096) throw Error('theme array length');
  // Browser serializers visit every array slot, including holes. Bound and
  // require own slots before cloning so sparse lengths cannot amplify transport.
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(input, index)) throw Error('theme sparse array');
  }
}
function copyEntries(input: object, bound: Bound, depth: number, array: boolean): unknown {
  if (array) checkArraySlots(input);
  const keys = Reflect.ownKeys(input);
  if (keys.length > 4096) throw Error('theme keys');
  const output = array ? [] : Object.create(null);
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw Error('theme key');
    countText(key, bound);
    const item = Object.getOwnPropertyDescriptor(input, key);
    if (!item?.enumerable || !('value' in item)) throw Error('theme accessor');
    Object.defineProperty(output, key, { value: copy(item.value, bound, depth + 1), enumerable: true });
  }
  return output;
}
function copy(input: unknown, bound: Bound, depth = 0): unknown {
  if (++bound.nodes > 4096 || depth > 32) throw Error('theme bounds');
  if (typeof input === 'string') return countText(input, bound);
  if (input === null || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return input;
  if (!input || typeof input !== 'object' || bound.seen.has(input)) throw Error('theme shape');
  const array = Array.isArray(input),
    prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) throw Error('theme prototype');
  bound.seen.add(input);
  const output = copyEntries(input, bound, depth, array);
  bound.seen.delete(input);
  return output;
}
function familyName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    Boolean(value.trim()) &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '<' || c === '>')
  );
}
function font(input: unknown): Omit<EncodedWitnessFont, 'base64'> & { readonly bytes: Uint8Array } {
  if (!input || typeof input !== 'object') throw Error('font shape');
  const keys = ['family', 'weight', 'style', 'sha256', 'profile', 'bytes'];
  if (Reflect.ownKeys(input).length !== keys.length) throw Error('font keys');
  const values: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const item = Object.getOwnPropertyDescriptor(input, key);
    if (!item?.enumerable || !('value' in item)) throw Error('font accessor');
    values[key] = item.value;
  }
  const { family, weight, style, sha256, profile, bytes } = values;
  if (!familyName(family)) throw Error('font family');
  if (weight !== 400 || style !== 'normal' || profile !== 'inter-latin-400-ascii' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))
    throw Error('font metadata');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw Error('font bytes');
  return { family, weight, style, sha256, profile, bytes };
}
/** Count/depth/byte preflight precedes encoding; no untrusted getters or JSON serialization. */
export function prepareWitnessInput(theme: unknown, fonts: unknown): PreparedWitnessInput | undefined {
  try {
    const bound: Bound = { nodes: 0, chars: 0, seen: new Set() };
    const snapshot = copy(theme, bound);
    if (!Array.isArray(fonts) || fonts.length > 8 || Reflect.ownKeys(fonts).length !== fonts.length + 1) return undefined;
    const admitted = [];
    let total = 0;
    for (let i = 0; i < fonts.length; i++) {
      const item = Object.getOwnPropertyDescriptor(fonts, i);
      if (!item || !('value' in item)) return undefined;
      const value = font(item.value);
      total += value.bytes.byteLength;
      if (total > 8 * 1024 * 1024) return undefined;
      admitted.push(value);
    }
    // Worst-case JSON string escaping (six bytes per code unit) plus structural
    // overhead and base64. Reject before encoding or structured browser transport.
    const predicted = bound.chars * 6 + bound.nodes * 32 + admitted.reduce((n, f) => n + 4 * Math.ceil(f.bytes.byteLength / 3) + 8192, 0);
    if (predicted > 32 * 1024 * 1024) return undefined;
    const encoded = admitted.map(({ bytes, ...metadata }) => ({ ...metadata, base64: Buffer.from(bytes).toString('base64') }));
    return { theme: snapshot, fonts: encoded, encodedBytes: predicted };
  } catch {
    return undefined;
  }
}
