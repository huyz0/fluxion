// What the adapters share: one POST that maps every failure to an `LlmError` built from a code and a status alone (never a body, a header or
// a thrown message: providers echo key fragments in 401 bodies, NFR-SEC-004), and a server-sent-events reader.
import { type AbortSignalLike, LlmError } from '@fluxion/dsl';

/** The `fetch` the adapters call; the platform one in the browser, a mock in tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A platform signal that aborts when `like` does. */
export function signalOf(like: AbortSignalLike): AbortSignal {
  const controller = new AbortController();
  if (like.aborted) controller.abort();
  else like.addEventListener('abort', () => controller.abort());
  return controller.signal;
}

const codeOf = (status: number): 'auth' | 'rate-limit' | 'bad-response' =>
  status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate-limit' : 'bad-response';

/** One request: where it goes, what it carries and what stops it. */
export type Call = {
  readonly fetch: FetchLike;
  readonly url: string;
  readonly headers: { readonly [name: string]: string };
  readonly body: object;
  readonly signal: AbortSignalLike;
};

/** The streaming response of a JSON POST; throws an `LlmError` when the request cannot be made or the answer is not 2xx. */
export async function postJson(call: Call): Promise<Response> {
  const like = call.signal;
  let response: Response;
  try {
    response = await call.fetch(call.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...call.headers },
      body: JSON.stringify(call.body),
      signal: signalOf(like),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new LlmError(like.aborted ? 'aborted' : 'network');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new LlmError(codeOf(response.status), response.status);
  }
  return response;
}

async function readPart(reader: ReadableStreamDefaultReader<Uint8Array>, like: AbortSignalLike): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read();
  } catch {
    throw new LlmError(like.aborted ? 'aborted' : 'network');
  }
}

/** The `data:` payloads of a server-sent-events body, in order. */
export async function* sseData(response: Response, like: AbortSignalLike): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new LlmError('bad-response', response.status);
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const part = await readPart(reader, like);
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() ?? '';
      for (const event of events) yield* dataLines(event);
    }
    yield* dataLines(pending);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function* dataLines(event: string): Generator<string> {
  for (const line of event.split(/\r?\n/)) {
    if (line.startsWith('data:')) yield line.slice(5).trimStart();
  }
}

/** `text` parsed as a JSON object, or a `bad-response` error. */
export function parseEvent(text: string): { readonly [key: string]: unknown } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null) return value as { readonly [key: string]: unknown };
  } catch {
    // falls through to the error
  }
  throw new LlmError('bad-response');
}
