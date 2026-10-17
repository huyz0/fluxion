import type { LlmChunk, LlmClient, LlmError, LlmRequest } from '@fluxion/dsl';
import { describe, expect, it } from 'vitest';
import { anthropicClient } from './anthropic.js';
import type { FetchLike } from './http.js';
import { openAiClient, openAiCompatibleClient } from './openai.js';

const KEY = 'sk-test-9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const request: LlmRequest = { system: 'SYSTEM', messages: [{ role: 'user', content: 'draw it' }] };
const live = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined };

const sse = (events: readonly string[]): Response =>
  new Response(
    new ReadableStream({
      start: (c) => {
        c.enqueue(new TextEncoder().encode(events.map((e) => `data: ${e}\n\n`).join('')));
        c.close();
      },
    }),
    { status: 200 },
  );

/** A fetch answering with `response`, and the calls it saw. */
function mock(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: FetchLike = (url, init) => {
    calls.push({ url, init });
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  };
  return { fetcher, calls };
}

const headerOf = (init: RequestInit | undefined, name: string): string | undefined => (init?.headers as Record<string, string> | undefined)?.[name];

async function collect(client: LlmClient, req: LlmRequest = request): Promise<LlmChunk[]> {
  const out: LlmChunk[] = [];
  for await (const c of client.stream(req, live)) out.push(c);
  return out;
}
const failure = async (client: LlmClient): Promise<LlmError> => {
  try {
    await collect(client);
  } catch (e) {
    return e as LlmError;
  }
  throw new Error('expected a failure');
};

describe('the Anthropic adapter (FR-AI-007, ADR-0041)', () => {
  const events = [
    '{"type":"message_start","message":{"usage":{"input_tokens":11}}}',
    '{"type":"content_block_delta","delta":{"type":"text_delta","text":"flux: 1"}}',
    '{"type":"content_block_delta","delta":{"type":"text_delta","text":"\\ntitle: T"}}',
    '{"type":"message_delta","usage":{"output_tokens":7}}',
    '{"type":"message_stop"}',
  ];

  it('FR-AI-007: the reply streams as text chunks, then usage, then done; the key travels in the header only', async () => {
    const { fetcher, calls } = mock(sse(events));
    const chunks = await collect(anthropicClient({ fetch: fetcher, apiKey: KEY, model: 'm1' }));
    expect(chunks).toEqual([
      { type: 'text', text: 'flux: 1' },
      { type: 'text', text: '\ntitle: T' },
      { type: 'usage', tokensIn: 11, tokensOut: 7 },
      { type: 'done' },
    ]);
    const call = calls[0];
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(headerOf(call?.init, 'x-api-key')).toBe(KEY);
    expect(String(call?.init.body)).not.toContain(KEY);
    expect(call?.init.credentials).toBe('omit');
  });

  it('FR-AI-007: the system prompt goes first and is marked for caching', async () => {
    const { fetcher, calls } = mock(sse(events));
    await collect(anthropicClient({ fetch: fetcher, apiKey: KEY, model: 'm1' }));
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.system[0]).toMatchObject({ text: 'SYSTEM', cache_control: { type: 'ephemeral' } });
    expect(body.stream).toBe(true);
  });

  it('FR-AI-007: a schema is answered through one forced tool and its JSON streams as text', async () => {
    const { fetcher, calls } = mock(
      sse(['{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}', '{"type":"message_stop"}']),
    );
    const client = anthropicClient({ fetch: fetcher, apiKey: KEY, model: 'm1' });
    expect(client.capabilities.structuredOutput).toBe(true);
    const chunks = await collect(client, { ...request, schema: { type: 'object' } });
    expect(chunks[0]).toEqual({ type: 'text', text: '{"a":' });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'reply' });
    expect(body.tools[0].input_schema).toEqual({ type: 'object' });
  });

  it('NFR-SEC-004: a 401 whose body echoes the key is an auth error that holds neither the body nor the key', async () => {
    const { fetcher } = mock(new Response(`{"error":{"message":"invalid x-api-key ${KEY}"}}`, { status: 401 }));
    const e = await failure(anthropicClient({ fetch: fetcher, apiKey: KEY, model: 'm1' }));
    expect(e).toMatchObject({ code: 'auth', status: 401 });
    expect(JSON.stringify([e.message, e.stack ?? '', e.code])).not.toContain(KEY.slice(0, 12));
  });

  it('FR-AI-007: 429 is rate-limit, other statuses bad-response, a thrown fetch is network, an aborted one is aborted', async () => {
    const mk = (r: Response | Error) => anthropicClient({ fetch: mock(r).fetcher, apiKey: KEY, model: 'm1' });
    expect(await failure(mk(new Response('', { status: 429 })))).toMatchObject({ code: 'rate-limit', status: 429 });
    expect(await failure(mk(new Response('', { status: 500 })))).toMatchObject({ code: 'bad-response', status: 500 });
    const thrown = await failure(mk(new TypeError(`failed to fetch with ${KEY}`)));
    expect(thrown).toMatchObject({ code: 'network' });
    expect(thrown.message).not.toContain(KEY);
    const aborted = { ...live, aborted: true };
    const client = mk(new Error('x'));
    await expect(
      (async () => {
        for await (const _ of client.stream(request, aborted)) void _;
      })(),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('FR-AI-007: an error event in the stream is bad-response without its text', async () => {
    const { fetcher } = mock(sse([`{"type":"error","error":{"message":"overloaded ${KEY}"}}`]));
    const e = await failure(anthropicClient({ fetch: fetcher, apiKey: KEY, model: 'm1' }));
    expect(e).toMatchObject({ code: 'bad-response' });
    expect(e.message).not.toContain(KEY);
  });
});

describe('the OpenAI adapters (FR-AI-007, ADR-0041)', () => {
  const events = [
    '{"choices":[{"delta":{"content":"flux: 1"}}]}',
    '{"choices":[{"delta":{}}]}',
    '{"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}',
    '[DONE]',
  ];

  it('FR-AI-007: OpenAI streams text then usage then done, sends the key as a bearer token and the system prompt first', async () => {
    const { fetcher, calls } = mock(sse(events));
    const client = openAiClient({ fetch: fetcher, apiKey: KEY, model: 'gpt' });
    expect(await collect(client)).toEqual([{ type: 'text', text: 'flux: 1' }, { type: 'usage', tokensIn: 5, tokensOut: 3 }, { type: 'done' }]);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headerOf(calls[0]?.init, 'authorization')).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(String(calls[0]?.init.body)).not.toContain(KEY);
  });

  it('FR-AI-007: OpenAI honours a schema through response_format; a compatible server does not and needs no key', async () => {
    const a = mock(sse(events));
    const openai = openAiClient({ fetch: a.fetcher, apiKey: KEY, model: 'gpt' });
    expect(openai.capabilities.structuredOutput).toBe(true);
    await collect(openai, { ...request, schema: { type: 'object' } });
    expect(JSON.parse(String(a.calls[0]?.init.body)).response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { schema: { type: 'object' }, strict: true },
    });

    const b = mock(sse(events));
    const local = openAiCompatibleClient({ fetch: b.fetcher, model: 'llama', baseUrl: 'http://localhost:11434/v1' });
    expect(local.capabilities.structuredOutput).toBe(false);
    await collect(local, { ...request, schema: { type: 'object' } });
    expect(b.calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(b.calls[0]?.init.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(String(b.calls[0]?.init.body))).not.toHaveProperty('response_format');
  });

  it('NFR-SEC-004: a 401 whose body echoes the key is an auth error that holds neither the body nor the key, for OpenAI and a compatible server', async () => {
    const body = `{"error":{"message":"Incorrect API key provided: ${KEY}"}}`;
    const a = await failure(openAiClient({ fetch: mock(new Response(body, { status: 401 })).fetcher, apiKey: KEY, model: 'gpt' }));
    const b = await failure(
      openAiCompatibleClient({ fetch: mock(new Response(body, { status: 401 })).fetcher, apiKey: KEY, model: 'x', baseUrl: 'http://h/v1' }),
    );
    for (const e of [a, b]) {
      expect(e).toMatchObject({ code: 'auth', status: 401 });
      expect(e.message).not.toContain(KEY.slice(0, 12));
    }
  });

  it('FR-AI-007: an event that is not JSON is bad-response', async () => {
    const e = await failure(openAiClient({ fetch: mock(sse(['not json'])).fetcher, apiKey: KEY, model: 'gpt' }));
    expect(e).toMatchObject({ code: 'bad-response' });
  });
});
