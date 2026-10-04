// The ways a file reaches the studio besides the picker and a drop (FR-FIL-006): a `?src=` URL, a pasted file, and a file the operating system
// launched the installed app with. Each yields the same `PickedFile` the picker does; opening it is `openPicked`.
import type { PickedFile } from './file-host.js';

/** The largest file the studio fetches or takes from the clipboard (a bigger one is refused before it is all read). */
export const MAX_OPEN_BYTES: number = 100 * 1024 * 1024;

/** Where `?src=` may point: the web's own schemes only. A relative URL is resolved against `base`. */
export function srcOf(search: string, base: string): URL | undefined {
  const raw = new URLSearchParams(search).get('src');
  if (raw === null || raw === '') return undefined;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The file name a URL ends in, or a stand-in when it ends in a slash. */
export function nameOfUrl(url: URL): string {
  const last = decodeURIComponent(
    url.pathname
      .split('/')
      .filter((s) => s !== '')
      .pop() ?? '',
  );
  return last === '' ? 'shared.flux' : last;
}

/** `response`'s body, refused once it passes {@link MAX_OPEN_BYTES} (the declared length is believed no further than the bytes read). */
async function boundedBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_OPEN_BYTES) throw new Error(`it is larger than ${MAX_OPEN_BYTES} bytes`);
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OPEN_BYTES) {
      await reader.cancel();
      throw new Error(`it is larger than ${MAX_OPEN_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** The file at `url`, or the reason it could not be fetched. Never rejects. */
export async function pickedFromUrl(url: URL, fetchIt: typeof fetch): Promise<{ ok: true; value: PickedFile } | { ok: false; error: string }> {
  const name = nameOfUrl(url);
  try {
    const response = await fetchIt(url.href, { credentials: 'omit', redirect: 'follow' });
    if (!response.ok) return { ok: false, error: `${name} could not be fetched: the server answered ${response.status}` };
    return { ok: true, value: { name, bytes: await boundedBody(response) } };
  } catch (e) {
    return { ok: false, error: `${name} could not be fetched: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The part of a clipboard the studio reads. */
export type ClipboardLike = { readonly files: ArrayLike<File>; readonly types: ArrayLike<string> };

/** The first pasted file whose name says it is a Fluxion file (any other pasted file is the editor's: an image on the canvas). Its size is the caller's to check against {@link MAX_OPEN_BYTES}. */
export function fluxionFileOf(clipboard: ClipboardLike | null | undefined): File | undefined {
  return Array.from(clipboard?.files ?? []).find((f) => /\.(flux|flux\.html)$/i.test(f.name));
}

/** A file the installed app was launched with (`launchQueue`): the handle of each, as a picked file with the handle to save back through. */
export type LaunchHandle = { readonly name: string; getFile(): Promise<File> };

/** The first launched file as a picked file, with its handle so a save writes over it. */
export async function pickedFromLaunch(handles: readonly LaunchHandle[]): Promise<PickedFile | undefined> {
  const handle = handles[0];
  if (handle === undefined) return undefined;
  const file = await handle.getFile();
  if (file.size > MAX_OPEN_BYTES) throw new Error(`${file.name} is larger than ${MAX_OPEN_BYTES} bytes`);
  return { name: handle.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
}
