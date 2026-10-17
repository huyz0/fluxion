// Which model the AI panel talks to (FR-AI-007, ADR-0041): the first provider that has a key, built through the adapters from the key store.
// The key is read only here, when a request is made, and the store registers it with the redactor on the way (rule 4).
import { type LlmClient, replayClient } from '@fluxion/dsl';
import { anthropicClient } from './anthropic.js';
import { idbKeyRecords } from './key-records.js';
import { createKeyStore, type KeyStore } from './key-store.js';
import { openAiClient } from './openai.js';
import { studioRedactor } from './redactor.js';

/** The key store of this page (keys rest in IndexedDB; the redactor learns each one as it is read). */
export const studioKeyStore = (): KeyStore => createKeyStore({ records: idbKeyRecords(indexedDB), crypto: globalThis.crypto, redactor: studioRedactor });

/** Gives the model to ask, or the sentence that says why there is none. */
export type ClientSource = () => Promise<{ readonly ok: true; readonly client: LlmClient } | { readonly ok: false; readonly problem: string }>;

const MODELS = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5' } as const;

let recorded: string | undefined;

/** Test mode: the next asks are answered with `text` (a recorded reply) and no provider is called. */
export function useRecordedReply(text: string | undefined): void {
  recorded = text;
}

/** The client of the first provider with a key. */
export const keyedClient: ClientSource = async () => {
  if (recorded !== undefined)
    return {
      ok: true,
      client: replayClient({ version: 1, source: 'scripted', model: 'recorded', requests: [{ chunks: [recorded], tokensIn: 0, tokensOut: 0 }] }).client,
    };
  const store = studioKeyStore();
  try {
    const have = await store.providers();
    const provider = (['anthropic', 'openai'] as const).find((p) => have.includes(p));
    if (provider === undefined) return { ok: false, problem: 'Add a provider key to ask the assistant.' };
    const apiKey = await store.get(provider);
    if (apiKey === undefined) return { ok: false, problem: 'Add a provider key to ask the assistant.' };
    const input = { fetch: (...args: Parameters<typeof fetch>) => fetch(...args), apiKey, model: MODELS[provider] };
    return { ok: true, client: provider === 'anthropic' ? anthropicClient(input) : openAiClient(input) };
  } catch {
    return { ok: false, problem: 'The stored key is locked: unlock it to ask the assistant.' };
  }
};

/** Teach the redactor every readable stored key now, so a log line written before the first request still cannot carry one (sealed keys wait for their passphrase). */
export async function registerStoredKeys(store: KeyStore = studioKeyStore()): Promise<void> {
  for (const provider of await store.providers().catch(() => [])) await store.get(provider).catch(() => undefined);
}
