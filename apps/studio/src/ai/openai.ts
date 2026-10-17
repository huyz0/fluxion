// The OpenAI and OpenAI-compatible adapters (FR-AI-007, ADR-0041): Chat Completions over `fetch`, streamed. OpenAI honours a JSON Schema
// (`response_format`); a compatible local server is plain text plus validation, and its key is optional.
import type { AbortSignalLike, LlmChunk, LlmClient, LlmRequest } from '@fluxion/dsl';
import { type FetchLike, parseEvent, postJson, sseData } from './http.js';

/** What an OpenAI-style adapter is built from. */
export type OpenAiInput = {
  readonly fetch: FetchLike;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
};

type Obj = { readonly [key: string]: unknown };
const objOf = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const numOf = (v: unknown): number => (typeof v === 'number' ? v : 0);

function bodyOf(model: string, request: LlmRequest, schemas: boolean): object {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    messages: [{ role: 'system', content: request.system }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))],
    ...(schemas && request.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', schema: request.schema, strict: true } } } : {}),
  };
}

function chunksOf(event: Obj): LlmChunk[] {
  const out: LlmChunk[] = [];
  const choices = event['choices'];
  const text = Array.isArray(choices) ? objOf(objOf(choices[0])['delta'])['content'] : undefined;
  if (typeof text === 'string' && text !== '') out.push({ type: 'text', text });
  const usage = event['usage'];
  if (usage !== null && typeof usage === 'object')
    out.push({ type: 'usage', tokensIn: numOf(objOf(usage)['prompt_tokens']), tokensOut: numOf(objOf(usage)['completion_tokens']) });
  return out;
}

function client(id: string, input: OpenAiInput, base: string, schemas: boolean): LlmClient {
  const headers: { [name: string]: string } = input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {};
  return {
    id,
    capabilities: { structuredOutput: schemas, vision: schemas },
    async *stream(request: LlmRequest, signal: AbortSignalLike): AsyncGenerator<LlmChunk> {
      const response = await postJson({ fetch: input.fetch, url: `${base}/chat/completions`, headers, body: bodyOf(input.model, request, schemas), signal });
      for await (const data of sseData(response, signal)) {
        if (data === '[DONE]') break;
        yield* chunksOf(parseEvent(data));
      }
      yield { type: 'done' };
    },
  };
}

/** A client for OpenAI. */
export function openAiClient(input: OpenAiInput & { readonly apiKey: string }): LlmClient {
  return client(`openai:${input.model}`, input, input.baseUrl ?? 'https://api.openai.com/v1', true);
}

/** A client for an OpenAI-compatible server (a local model, a gateway) at `baseUrl`, such as `http://localhost:11434/v1`. */
export function openAiCompatibleClient(input: OpenAiInput & { readonly baseUrl: string }): LlmClient {
  return client(`openai-compatible:${input.model}`, input, input.baseUrl, false);
}
