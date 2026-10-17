// The language-model port (ADR-0041): types and one error class, no I/O. Adapters live in the studio; the orchestrator and the eval harness
// see only this.

/**
 * The part of an `AbortSignal` the port reads (this package has no DOM types); the platform signal satisfies it.
 *
 * @public
 */
export type AbortSignalLike = {
  /** True once the run was asked to stop. */
  readonly aborted: boolean;
  /** Listens for the abort. */
  addEventListener(type: 'abort', listener: () => void): void;
  /** Stops listening. */
  removeEventListener(type: 'abort', listener: () => void): void;
};

/**
 * One request to a model. The system prompt comes first so a provider can cache it.
 *
 * @public
 */
export type LlmRequest = {
  /** The standing instructions: the cheat sheet and the catalog. */
  readonly system: string;
  /** The conversation, oldest first. */
  readonly messages: readonly LlmMessage[];
  /** A JSON Schema the reply must satisfy, for a client whose `structuredOutput` capability is true. */
  readonly schema?: object;
  /** The most tokens the reply may hold. */
  readonly maxTokens?: number;
};

/**
 * Some of the reply's text.
 *
 * @public
 */
export type LlmTextChunk = {
  /** Discriminant. */
  readonly type: 'text';
  /** The text. */
  readonly text: string;
};

/**
 * Tokens used, reported by the provider.
 *
 * @public
 */
export type LlmUsageChunk = {
  /** Discriminant. */
  readonly type: 'usage';
  /** Tokens read. */
  readonly tokensIn: number;
  /** Tokens written. */
  readonly tokensOut: number;
};

/**
 * The end of the reply.
 *
 * @public
 */
export type LlmDoneChunk = {
  /** Discriminant. */
  readonly type: 'done';
};

/**
 * A piece of a streamed reply.
 *
 * @public
 */
export type LlmChunk = LlmTextChunk | LlmUsageChunk | LlmDoneChunk;

/**
 * What a provider can do.
 *
 * @public
 */
export type LlmCapabilities = {
  /** Honours `LlmRequest.schema`. */
  readonly structuredOutput: boolean;
  /** Accepts images. */
  readonly vision: boolean;
};

/**
 * One turn of a conversation.
 *
 * @public
 */
export type LlmMessage = {
  /** Who spoke. */
  readonly role: 'user' | 'assistant';
  /** What was said. */
  readonly content: string;
};

/**
 * A model provider, as the orchestrator uses it.
 *
 * @public
 */
export type LlmClient = {
  /** Names the provider and model in results and recordings. */
  readonly id: string;
  /** What the provider can do; the orchestrator falls back to plain text plus validation without `structuredOutput`. */
  readonly capabilities: LlmCapabilities;
  /** Streams the reply; throws an `LlmError` on failure and stops when `signal` aborts. */
  stream(request: LlmRequest, signal: AbortSignalLike): AsyncIterable<LlmChunk>;
};

/**
 * Why a request failed.
 *
 * @public
 */
export type LlmErrorCode = 'auth' | 'rate-limit' | 'network' | 'aborted' | 'bad-response';

/**
 * A failed request. The message is built from the code and the HTTP status alone, never from a response body or a header, because providers
 * echo key fragments in their 401 bodies (NFR-SEC-004).
 *
 * @public
 */
export class LlmError extends Error {
  /** What kind of failure. */
  readonly code: LlmErrorCode;
  /** The HTTP status, when the failure had one. */
  readonly status: number | undefined;

  /** Builds the error; the message is `llm <code>` plus the status. */
  constructor(code: LlmErrorCode, status?: number) {
    super(status === undefined ? `llm ${code}` : `llm ${code} (HTTP ${status})`);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}
