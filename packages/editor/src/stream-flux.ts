// Progressive render of a streamed FluxScript source (FR-AI-010, 06-ai-authoring.md §3): the open document grows screen by screen as the
// stream's blocks complete. The compiler is `@fluxion/dsl`'s, loaded on first use from a lazy chunk (ADR-0032: the editor's initial chunk has
// no compiler); `stream/stream-flux.ts` is that chunk.
import type { StreamFluxOptions, StreamFluxResult } from './stream-flux-types.js';

export type { StreamFluxOptions, StreamFluxResult } from './stream-flux-types.js';

/**
 * Feed a streamed FluxScript source into the open document screen by screen: each screen is written the moment its block completes (never
 * half a screen), so the canvas renders progressively. The whole stream is one undo step. At the end the document equals the whole-file
 * compile; a tail key that changes how screens compile makes the end recompile the whole file, and the diagnostics are then replaced.
 *
 * @param source - the text, in chunks of any size (an async iterable, or a web ReadableStream)
 * @param options - the store, registries and session to write to
 * @returns how the stream ended
 * @public
 */
export async function streamFluxScript(source: AsyncIterable<string> | ReadableStream<string>, options: StreamFluxOptions): Promise<StreamFluxResult> {
  const { runFluxStream } = await import('./stream/stream-flux.js');
  return runFluxStream(source, options);
}
