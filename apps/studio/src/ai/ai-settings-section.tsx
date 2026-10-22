// The AI panel's settings (FR-AI-007, M17.19): the provider key (kept in the key store, never shown again), an OpenAI-compatible base URL and
// model, and whether a save embeds external images (FR-AST-006). The settings apply to the next request.
import { t } from '@lingui/core/macro';
import { type JSX, useState } from 'react';
import { localSettings } from '../local-settings.js';
import { EMBED_EXTERNAL_SETTING } from '../url-reader.js';
import { AI_BASE_URL_SETTING, AI_MODEL_SETTING, aiSetting, readBaseUrl, setAiSetting } from './ai-settings.js';
import { studioKeyStore } from './client.js';

/** The providers a key can be kept for. */
const PROVIDERS = ['anthropic', 'openai'] as const;
type Provider = (typeof PROVIDERS)[number];

const WIDE = { display: 'block', width: '100%' } as const;

/** The settings fieldset of the AI panel. */
export function AiSettingsSection(): JSX.Element {
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(aiSetting(AI_BASE_URL_SETTING) ?? '');
  const [model, setModel] = useState(aiSetting(AI_MODEL_SETTING) ?? '');
  const [embed, setEmbed] = useState(localSettings().get(EMBED_EXTERNAL_SETTING) === true);
  const [said, setSaid] = useState('');

  // an OpenAI-compatible server is asked with the OpenAI key, so a key entered with a base URL is kept as that one
  const compatible = baseUrl.trim() !== '';
  const save = async () => {
    const url = readBaseUrl(baseUrl);
    if (url === undefined) return setSaid(t`The base URL must be an http or https address.`);
    setBaseUrl(url);
    setAiSetting(AI_BASE_URL_SETTING, url);
    setAiSetting(AI_MODEL_SETTING, model);
    if (key !== '') {
      try {
        await studioKeyStore().set(compatible ? 'openai' : provider, key);
        setKey('');
      } catch {
        return setSaid(t`The key could not be saved.`);
      }
    }
    setSaid(t`Saved. The next request uses these settings.`);
  };

  return (
    <fieldset aria-label={t`AI settings`} style={{ marginBottom: 8 }}>
      <legend>{t`AI settings`}</legend>
      <label>
        {t`Provider`}{' '}
        <select value={compatible ? 'openai' : provider} disabled={compatible} onChange={(e) => setProvider(e.target.value as Provider)}>
          <option value="anthropic">{t`Anthropic`}</option>
          <option value="openai">{t`OpenAI`}</option>
        </select>
      </label>
      <label>
        {t`API key`}
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} style={WIDE} />
      </label>
      <label>
        {t`Base URL (OpenAI-compatible)`}
        <input type="url" value={baseUrl} placeholder={t`http://localhost:11434/v1`} onChange={(e) => setBaseUrl(e.target.value)} style={WIDE} />
      </label>
      <label>
        {t`Model`}
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} style={WIDE} />
      </label>
      <button type="button" onClick={() => void save()}>
        {t`Save settings`}
      </button>
      <label style={{ display: 'block' }}>
        <input
          type="checkbox"
          checked={embed}
          onChange={(e) => {
            setEmbed(e.target.checked);
            localSettings().set(EMBED_EXTERNAL_SETTING, e.target.checked);
          }}
        />{' '}
        {t`Embed external images when saving`}
      </label>
      <p role="status" aria-live="polite">
        {said}
      </p>
    </fieldset>
  );
}
