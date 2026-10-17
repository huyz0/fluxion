// Ask a model for an AI patch (FR-EDT-014, ADR-0035): the request carries the patch schema and what is in scope; the reply is read as JSON.
import { type AbortSignalLike, type LlmClient, patchJsonSchema, strictPatchJsonSchema } from '@fluxion/dsl';

/** What the person asked, and the part of the document in scope. */
export type AskInput = { readonly client: LlmClient; readonly prompt: string; readonly scope: string; readonly signal: AbortSignalLike };

/** A patch, or why none could be read. */
export type Asked = { readonly ok: true; readonly patch: unknown } | { readonly ok: false; readonly problem: string };

const SYSTEM = [
  'You edit a Fluxion diagram document by replying with ONE JSON object: an AI patch ({"flux":1,"ops":[...]}).',
  'Ops: add, update, remove, connect, disconnect, setLayout, restyle. Reply with the JSON only, no prose.',
  'Refer to existing things by slug or #<RecordId> exactly as listed in the scope; give new nodes new lowercase slugs.',
  `The patch JSON Schema: ${JSON.stringify(patchJsonSchema())}`,
].join('\n');

/** The JSON object in `text`, which a model may have wrapped in a code fence or a sentence. */
export function jsonOf(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const from = fenced.indexOf('{');
  const to = fenced.lastIndexOf('}');
  if (from < 0 || to < from) return undefined;
  try {
    return JSON.parse(fenced.slice(from, to + 1));
  } catch {
    return undefined;
  }
}

/** Ask `client` for a patch that does `prompt` within `scope`. */
export async function askForPatch(input: AskInput): Promise<Asked> {
  const { client, prompt, scope, signal } = input;
  let text = '';
  try {
    for await (const chunk of client.stream(
      {
        system: SYSTEM,
        messages: [{ role: 'user', content: `Scope:\n${scope}\n\nRequest: ${prompt}` }],
        ...(client.capabilities.structuredOutput ? { schema: strictPatchJsonSchema() } : {}),
      },
      signal,
    )) {
      if (chunk.type === 'text') text += chunk.text;
    }
  } catch (error) {
    // an LlmError carries a code and a status, never a body (rule 26)
    const code = (error as { code?: unknown }).code;
    return { ok: false, problem: `The model could not be reached (${typeof code === 'string' ? code : 'error'}).` };
  }
  const patch = jsonOf(text);
  return patch === undefined ? { ok: false, problem: 'The model did not reply with a patch.' } : { ok: true, patch };
}
