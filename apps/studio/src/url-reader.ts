// Reading an external image for "embed on save" (FR-AST-006): the `FileIO` read port over `fetch`. The request carries no cookies and no
// referrer. A page whose Content-Security-Policy blocks the address, an offline browser, a CORS refusal and a non-2xx answer are all the same
// to the save: the bytes were not there, so the image stays external and the person is told.
import type { CoreError, FileIO } from '@fluxion/core';
import { MAX_IMPORT_BYTES } from '@fluxion/format';
import { err, ok, type Result } from '@fluxion/schema';
import { localSettings } from './local-settings.js';

/** The setting that turns embedding of external images on save on (it is off until the setting is `true`: a save fetches only what the person allowed). */
export const EMBED_EXTERNAL_SETTING = 'fluxion.embedExternalAssets';

/** Whether a save embeds external images: only when the person turned it on. */
export function embedExternalOn(): boolean {
  return localSettings().get(EMBED_EXTERNAL_SETTING) === true;
}

const failure = (url: string, cause: unknown): Result<Uint8Array, CoreError> => err({ code: 'FILE_IO', message: `${url} could not be fetched`, cause });

/** How long one image may take: a save must not hang on a host that never answers. */
const FETCH_TIMEOUT_MS = 10_000;

/** The body of `response`, read in chunks and stopped past the import cap, so a host that never ends cannot fill memory. */
async function capped(url: string, response: Response): Promise<Result<Uint8Array, CoreError>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (;;) {
    const part = await reader?.read();
    if (part === undefined || part.done) break;
    size += part.value.length;
    if (size > MAX_IMPORT_BYTES) {
      await reader?.cancel();
      return failure(url, 'too large');
    }
    chunks.push(part.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return ok(out);
}

/** The bytes at `url`, fetched without credentials, within the timeout and no more than the import cap (a larger body is refused unread). */
async function read(url: string): Promise<Result<Uint8Array, CoreError>> {
  try {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    if (!response.ok) return failure(url, response.status);
    return await capped(url, response);
  } catch (cause) {
    return failure(url, cause);
  }
}

/** The read port of {@link FileIO} over `fetch`; the studio never writes through it. */
export const urlReader: Pick<FileIO, 'read'> = { read };
