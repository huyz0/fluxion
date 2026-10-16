// What a tool returns (ADR-0038): structured content plus a one-line text, or an error result carrying the diagnostics.

/** A diagnostic as a tool reports it. */
export type Diag = { readonly code: string; readonly severity: string; readonly message: string; readonly hint?: string | undefined };

/** A tool result. */
export type Reply = { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown>; isError?: true };

/** An error result: the codes and messages in the text, the diagnostics in the structured content. */
export function failure(diagnostics: readonly Diag[]): Reply {
  const text = diagnostics.map((d) => `${d.code}: ${d.message}`).join('; ') || 'failed';
  return { isError: true, content: [{ type: 'text', text }], structuredContent: { diagnostics } };
}

/** A success: `summary` as the text, `result` and `extra` (handle, revision) and the diagnostics as structured content. */
export function success(summary: string, result: Record<string, unknown>, diagnostics: readonly Diag[], extra: Record<string, unknown> = {}): Reply {
  return { content: [{ type: 'text', text: summary }], structuredContent: { ...result, ...extra, diagnostics } };
}

/** A usage error. */
export const usage = (message: string): Diag => ({ code: 'FLX_CLI_USAGE', severity: 'error', message });
