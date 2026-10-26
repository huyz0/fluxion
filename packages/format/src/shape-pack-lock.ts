import { parseShapePackSubset, type ShapePackLicensePolicy, type ShapePackSubset } from '@fluxion/core';
import { checkedSchema, type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { encodeBase64 } from './base64.js';
import type { FormatError } from './errors.js';
import type { ContentHasher } from './flux-write-types.js';
import type { ShapePackDataLock } from './shape-pack-prepare.js';
import { decodeUtf8Strict } from './utf8.js';

const lockSchema = checkedSchema<ShapePackDataLock>()(
  z.strictObject({
    kind: z.literal('declarative-shapes'),
    id: z.string().min(1),
    version: z.string().min(1),
    packFormat: z.literal('1.0'),
    entry: z.string().min(1),
    integrity: z.string().regex(/^sha256-[A-Za-z0-9+/]{43}=$/),
  }),
);
const listedSchema = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().nonnegative() });
const object = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input);
/** Whether the opaque value explicitly declares the known data-only kind. */
export const isShapePackLock = (input: unknown): boolean => object(input) && input['kind'] === 'declarative-shapes';
const failure = (path: string, message: string, diagnostics?: readonly Diagnostic[]): Result<never, FormatError> =>
  err({
    code: 'FILE_SHAPE_PACK_INVALID',
    message,
    diagnostics: diagnostics ?? [{ code: 'FLX_PACK_INVALID', severity: 'error', path, message }],
  });

/** Data accepted atomically; unknown locks are never interpreted. */
export type ValidatedShapePacks = { readonly locks: readonly ShapePackDataLock[]; readonly subsets: readonly ShapePackSubset[] };
type Captured = { readonly lock: ShapePackDataLock; readonly bytes: Uint8Array; readonly path: string };
function invalidIdentity(lock: ShapePackDataLock, ids: ReadonlySet<string>, paths: ReadonlySet<string>): boolean {
  return lock.entry !== `plugins/${lock.id}@${lock.version}/defs.json` || ids.has(lock.id) || paths.has(lock.entry);
}

function capture(plugins: unknown, entries: ReadonlyMap<string, Uint8Array>): Result<Captured[], FormatError> {
  if (!Array.isArray(plugins)) return isShapePackLock(plugins) ? failure('/plugins', 'known locks must be in an array') : ok([]);
  const out: Captured[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [i, raw] of plugins.entries()) {
    if (!isShapePackLock(raw)) continue;
    const path = `/plugins/${i}`;
    const parsed = lockSchema.safeParse(raw);
    if (!parsed.success)
      return failure(
        path,
        'invalid declarative shape lock',
        parsed.error.issues.map((issue) => ({
          code: 'FLX_PACK_INVALID',
          severity: 'error',
          path: path + jsonPointer(issue.path.map((p) => String(p))),
          message: issue.message,
        })),
      );
    const lock = parsed.data;
    if (invalidIdentity(lock, ids, paths)) return failure(path, 'known shape lock path or namespace is invalid or duplicated');
    const bytes = entries.get(lock.entry);
    if (!bytes) return failure(path, 'known shape entry is missing');
    ids.add(lock.id);
    paths.add(lock.entry);
    out.push({ lock, bytes: bytes.slice(), path });
  }
  return ok(out);
}
function manifestMatches(listed: unknown, item: Captured, hex: string): boolean {
  if (!object(listed)) return false;
  const parsed = listedSchema.safeParse(listed[item.lock.entry]);
  return parsed.success && parsed.data.sha256 === hex && parsed.data.size === item.bytes.length;
}
function parseEntry(item: Captured, policy: ShapePackLicensePolicy): Result<ShapePackSubset, FormatError> {
  const text = decodeUtf8Strict(item.bytes);
  if (text === undefined) return failure(item.path, 'shape entry is not valid UTF-8');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return failure(item.path, 'shape entry is not valid JSON');
  }
  const parsed = parseShapePackSubset(input, policy);
  if (!parsed.ok)
    return failure(
      item.path,
      'shape entry failed validation',
      parsed.error.map((d) => ({ ...d, path: `${item.path}${d.path}` })),
    );
  if (parsed.value.id !== item.lock.id || parsed.value.version !== item.lock.version) return failure(item.path, 'shape entry identity differs from its lock');
  return parsed;
}

function integrityMatches(item: Captured, hex: string, digest: string, manifest: { readonly entries: unknown } | undefined): boolean {
  return item.lock.integrity === `sha256-${digest}` && (manifest === undefined || manifestMatches(manifest.entries, item, hex));
}

/** Check known locks and bytes; providing manifest entries additionally requires exact hash/size agreement. */
export async function validateShapePackEntries(
  plugins: unknown,
  entries: ReadonlyMap<string, Uint8Array>,
  options: { readonly policy: ShapePackLicensePolicy | undefined; readonly hasher: ContentHasher; readonly manifest?: { readonly entries: unknown } },
): Promise<Result<ValidatedShapePacks, FormatError>> {
  const { policy, hasher, manifest } = options;
  const captured = capture(plugins, entries);
  if (!captured.ok) return captured;
  if (!captured.value.length) return ok({ locks: [], subsets: [] });
  if (typeof policy !== 'function') return failure('/plugins', 'known shape data requires an explicit content policy');
  try {
    const hash = hasher.sha256.bind(hasher);
    const subsets: ShapePackSubset[] = [];
    for (const item of captured.value) {
      const hex = await hash(item.bytes.slice());
      if (!/^[0-9a-f]{64}$/.test(hex)) return failure(item.path, 'hash port returned an invalid SHA-256 digest');
      const digest = encodeBase64(Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
      if (!integrityMatches(item, hex, digest, manifest)) return failure(item.path, 'shape entry does not match its lock or manifest hash and size');
      const subset = parseEntry(item, policy);
      if (!subset.ok) return subset;
      subsets.push(subset.value);
    }
    return ok({ locks: captured.value.map((item) => item.lock), subsets });
  } catch {
    return failure('/plugins', 'shape-pack validation failed in the policy or hash port');
  }
}
