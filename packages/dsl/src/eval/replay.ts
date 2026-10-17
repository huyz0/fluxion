// A model that answers from a recording (ADR-0039): the recorded run replaces the provider with its recorded bytes and runs the rest for real.
import { type AbortSignalLike, type LlmChunk, type LlmClient, LlmError, type LlmRequest } from '../generate/llm.js';
import type { Recording } from './case.js';

/**
 * A replaying client, and how many of its recorded requests were asked for.
 *
 * @public
 */
export type Replay = {
  /** The client to hand to the orchestrator. */
  readonly client: LlmClient;
  /** Requests answered so far. */
  readonly used: () => number;
  /** True once a request came after the last recorded one. */
  readonly exhausted: () => boolean;
};

/**
 * A client that answers request n with the n-th recorded reply and fails with `bad-response` after the last one.
 *
 * @public
 */
export function replayClient(recording: Recording): Replay {
  let used = 0;
  let exhausted = false;
  const client: LlmClient = {
    id: `replay:${recording.model}`,
    capabilities: { structuredOutput: false, vision: false },
    async *stream(_request: LlmRequest, _signal: AbortSignalLike): AsyncIterable<LlmChunk> {
      const reply = recording.requests[used];
      if (!reply) {
        exhausted = true;
        throw new LlmError('bad-response');
      }
      used++;
      for (const text of reply.chunks) yield { type: 'text', text };
      yield { type: 'usage', tokensIn: reply.tokensIn, tokensOut: reply.tokensOut };
      yield { type: 'done' };
    },
  };
  return { client, used: () => used, exhausted: () => exhausted };
}
