import { type SvgImportFont, sha256Hex } from '@fluxion/format';
import { type Theme, themeSchema } from '@fluxion/theme';

export type WitnessFont = SvgImportFont & {
  readonly bytes: Uint8Array;
  readonly profile: 'inter-latin-400-ascii';
};
export type WitnessContext = { readonly theme: Theme; readonly fonts: readonly (WitnessFont & { readonly bytes: Uint8Array<ArrayBuffer> })[] };
export type PaintContext = WitnessContext & { readonly styles: Readonly<Record<string, string>> };
const FONT_HASH = '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc';
const FONT_LIMIT = 8 * 1024 * 1024;
type Budget = { nodes: number; chars: number; seen: Set<object> };
function text(value: string, budget: Budget): string {
  budget.chars += value.length;
  if (budget.chars > 262144) throw Error('context text');
  return value;
}
function entries(input: object, budget: Budget, depth: number, array: boolean): unknown {
  const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
  const keys = Reflect.ownKeys(input);
  if (keys.length > 4096) throw Error('context keys');
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw Error('context symbol');
    text(key, budget);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw Error('context accessor');
    Object.defineProperty(output, key, { value: plain(descriptor.value, budget, depth + 1), enumerable: true });
  }
  return Object.freeze(output);
}
function plain(input: unknown, budget: Budget, depth = 0): unknown {
  budget.nodes++;
  if (budget.nodes > 4096 || depth > 32) throw Error('context bounds');
  if (typeof input === 'string') return text(input, budget);
  if (input === null || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return input;
  if (!input || typeof input !== 'object' || budget.seen.has(input)) throw Error('context shape');
  const prototype = Object.getPrototypeOf(input),
    array = Array.isArray(input);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) throw Error('context prototype');
  budget.seen.add(input);
  const output = entries(input, budget, depth, array);
  budget.seen.delete(input);
  return output;
}
function descriptor(input: unknown): WitnessFont | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const values = Object.getOwnPropertyDescriptors(input);
  const names = ['family', 'weight', 'style', 'sha256', 'bytes', 'profile'];
  if (Reflect.ownKeys(values).length !== names.length || names.some((n) => !values[n]?.enumerable || !('value' in (values[n] ?? {})))) return undefined;
  const family: unknown = values['family']?.value,
    bytes: unknown = values['bytes']?.value;
  if (
    typeof family !== 'string' ||
    family.length > 256 ||
    !family.trim() ||
    [...family].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '<' || c === '>')
  )
    return undefined;
  if (
    values['weight']?.value !== 400 ||
    values['style']?.value !== 'normal' ||
    values['sha256']?.value !== FONT_HASH ||
    values['profile']?.value !== 'inter-latin-400-ascii'
  )
    return undefined;
  if (!ArrayBuffer.isView(bytes) || !(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > FONT_LIMIT) return undefined;
  return { family, weight: 400, style: 'normal', sha256: FONT_HASH, profile: 'inter-latin-400-ascii', bytes };
}
function ownedFonts(input: unknown): WitnessContext['fonts'] | undefined {
  if (!Array.isArray(input) || input.length > 8 || Reflect.ownKeys(input).length !== input.length + 1) return undefined;
  const admitted: WitnessFont[] = [];
  let total = 0;
  for (let i = 0; i < input.length; i++) {
    const property = Object.getOwnPropertyDescriptor(input, i);
    const font = property && 'value' in property ? descriptor(property.value) : undefined;
    if (!font || admitted.some((f) => f.family === font.family)) return undefined;
    total += font.bytes.byteLength;
    if (total > FONT_LIMIT) return undefined;
    admitted.push(font);
  }
  // Check the whole aggregate before allocating any owning buffer (Buffer.slice must never alias).
  const owned = admitted.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) }));
  return owned.every((f) => sha256Hex(f.bytes) === f.sha256) ? owned : undefined;
}
/** Bounded descriptor traversal precedes recursive theme schema validation and resource copies. */
export function snapshotWitnessContext(theme: unknown, fonts: unknown): WitnessContext | undefined {
  try {
    const snapshot = plain(theme, { nodes: 0, chars: 0, seen: new Set() });
    const parsed = themeSchema.safeParse(snapshot);
    if (!parsed.success) return undefined;
    const owned = ownedFonts(fonts);
    return owned ? { theme: snapshot as Theme, fonts: owned } : undefined;
  } catch {
    return undefined;
  }
}
