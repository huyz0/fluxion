// Which model the AI panel talks to (FR-AI-007, ADR-0041): the first provider that has a key, built through the adapters from the key store.
// The key is read only here, when a request is made, and the store registers it with the redactor on the way (rule 4).
import { type LlmClient, replayClient } from '@fluxion/dsl';
import { t } from '@lingui/core/macro';
import { AI_BASE_URL_SETTING, AI_MODEL_SETTING, aiSetting } from './ai-settings.js';
import { anthropicClient } from './anthropic.js';
import { idbKeyRecords } from './key-records.js';
import { createKeyStore, type KeyStore } from './key-store.js';
import { openAiClient, openAiCompatibleClient } from './openai.js';
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
  try {
    return await storedClient(studioKeyStore());
  } catch {
    return { ok: false, problem: t`The stored key is locked: unlock it to ask the assistant.` };
  }
};

/** The model to ask from the stored keys and settings: a base URL names an OpenAI-compatible server, else the first provider with a key. */
async function storedClient(store: KeyStore): ReturnType<ClientSource> {
  const baseUrl = aiSetting(AI_BASE_URL_SETTING);
  const model = aiSetting(AI_MODEL_SETTING);
  const send = (...args: Parameters<typeof fetch>) => fetch(...args);
  const have = await store.providers();
  if (baseUrl !== undefined) {
    // asked with the OpenAI key when there is one (a local server may need none)
    const apiKey = have.includes('openai') ? await store.get('openai') : undefined;
    return { ok: true, client: openAiCompatibleClient({ fetch: send, model: model ?? MODELS.openai, baseUrl, ...(apiKey === undefined ? {} : { apiKey }) }) };
  }
  const provider = (['anthropic', 'openai'] as const).find((p) => have.includes(p));
  const apiKey = provider === undefined ? undefined : await store.get(provider);
  if (provider === undefined || apiKey === undefined) return { ok: false, problem: t`Add a provider key to ask the assistant.` };
  const input = { fetch: send, apiKey, model: model ?? MODELS[provider] };
  return { ok: true, client: provider === 'anthropic' ? anthropicClient(input) : openAiClient(input) };
}

/** Teach the redactor every readable stored key now, so a log line written before the first request still cannot carry one (sealed keys wait for their passphrase). */
export async function registerStoredKeys(store: KeyStore = studioKeyStore()): Promise<void> {
  for (const provider of await store.providers().catch(() => [])) await store.get(provider).catch(() => undefined);
}
