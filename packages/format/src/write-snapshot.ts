import { parseDocument, serializeDocument } from '@fluxion/schema';
import { z } from 'zod';
import type { WriteFluxInput } from './flux-write-types.js';

/** Snapshot opaque JSON locks and entry bytes before their validation can await. */
export function snapshotPackData(input: WriteFluxInput): WriteFluxInput {
  return {
    ...input,
    plugins: z.array(z.unknown()).parse(JSON.parse(JSON.stringify(input.plugins ?? []))),
    extraEntries: new Map([...(input.extraEntries ?? [])].map(([name, bytes]) => [name, bytes.slice()])),
  };
}

/** Portable composition owns one document/asset revision across asynchronous preparation. */
export function snapshotWriteInput(input: WriteFluxInput): WriteFluxInput {
  const serialized = serializeDocument(input.document);
  const document = parseDocument(serialized);
  if (!document.ok || serializeDocument(document.value.document) !== serialized)
    throw new Error('portable document requires explicit migration or repair before saving');
  return {
    ...snapshotPackData(input),
    document: document.value.document,
    hasher: { sha256: input.hasher.sha256.bind(input.hasher) },
    ...(input.assets === undefined ? {} : { assets: new Map([...input.assets].map(([id, asset]) => [id, { ...asset, bytes: asset.bytes.slice() }])) }),
    ...(input.preview === undefined ? {} : { preview: input.preview.slice() }),
    ...(input.manifestExtras === undefined
      ? {}
      : { manifestExtras: z.record(z.string(), z.unknown()).parse(JSON.parse(JSON.stringify(input.manifestExtras))) }),
  };
}
