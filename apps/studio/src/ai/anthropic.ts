// The Anthropic adapter (FR-AI-007, ADR-0041): the Messages API over `fetch`, streamed. A request with a schema is answered through one forced
// tool whose input is the schema, so `structuredOutput` holds; the tool's JSON arrives as text chunks.
import { type AbortSignalLike, type LlmChunk, type LlmClient, LlmError, type LlmRequest } from '@fluxion/dsl';
import { type FetchLike, parseEvent, postJson, sseData } from './http.js';

/** What an adapter is built from. */
export type AdapterInput = {
  readonly fetch: FetchLike;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
};

const DEFAULT_MAX_TOKENS = 8192;
const REPLY_TOOL = 'reply';

type Obj = { readonly [key: string]: unknown };
const objOf = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const numOf = (v: unknown): number => (typeof v === 'number' ? v : 0);

function bodyOf(model: string, request: LlmRequest): object {
  return {
    model,
    stream: true,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    // the system prompt first and marked, so the provider can cache it
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(request.schema
      ? { tools: [{ name: REPLY_TOOL, description: 'The reply.', input_schema: request.schema }], tool_choice: { type: 'tool', name: REPLY_TOOL } }
      : {}),
  };
}

/** The chunks one event stands for, and the tokens read so far. */
function chunksOf(event: Obj, tokensIn: { value: number }): LlmChunk[] {
  const delta = objOf(event['delta']);
  switch (event['type']) {
    case 'message_start':
      tokensIn.value = numOf(objOf(objOf(event['message'])['usage'])['input_tokens']);
      return [];
    case 'content_block_delta':
      if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') return [{ type: 'text', text: delta['text'] }];
      if (delta['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') return [{ type: 'text', text: delta['partial_json'] }];
      return [];
    case 'message_delta':
      return [{ type: 'usage', tokensIn: tokensIn.value, tokensOut: numOf(objOf(event['usage'])['output_tokens']) }];
    default:
      return [];
  }
}

/** A client for the Anthropic Messages API. */
export function anthropicClient(input: AdapterInput): LlmClient {
  const url = `${input.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
  const headers = { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  return {
    id: `anthropic:${input.model}`,
    capabilities: { structuredOutput: true, vision: true },
    async *stream(request: LlmRequest, signal: AbortSignalLike): AsyncGenerator<LlmChunk> {
      const response = await postJson({ fetch: input.fetch, url, headers, body: bodyOf(input.model, request), signal });
      const tokensIn = { value: 0 };
      for await (const data of sseData(response, signal)) {
        const event = parseEvent(data);
        if (event['type'] === 'error') throw new LlmError('bad-response');
        yield* chunksOf(event, tokensIn);
        if (event['type'] === 'message_stop') break;
      }
      yield { type: 'done' };
    },
  };
}
