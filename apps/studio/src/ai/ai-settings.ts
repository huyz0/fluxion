// The AI panel's settings (FR-AI-007): where an OpenAI-compatible server is and which model it runs. Neither is a secret, so both rest in the
// studio's settings (ADR-0029); the provider key itself rests only in the key store (ADR-0041).
import { localSettings } from '../local-settings.js';

/** The setting that holds the base URL of an OpenAI-compatible server, such as `http://localhost:11434/v1`. */
export const AI_BASE_URL_SETTING = 'fluxion.ai.baseUrl';
/** The setting that holds the model name sent to the provider; empty means the provider's default. */
export const AI_MODEL_SETTING = 'fluxion.ai.model';

/** A string setting, or undefined when it is not set or blank. */
export function aiSetting(name: string): string | undefined {
  const value = localSettings().get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Keep a string setting; a blank value clears it. */
export function setAiSetting(name: string, value: string): void {
  localSettings().set(name, value.trim());
}

/** A base URL as kept: an http(s) address without trailing slashes, `''` for none, or undefined when it is not one. */
export function readBaseUrl(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed.replace(/\/+$/, '') : undefined;
  } catch {
    return undefined;
  }
}
