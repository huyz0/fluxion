// FR-AI-007 (M17.19): the base URL of an OpenAI-compatible server is kept only as an http(s) address, without trailing slashes.
import { describe, expect, it } from 'vitest';
import { readBaseUrl } from './ai-settings.js';

describe('the AI base URL setting (FR-AI-007)', () => {
  it('FR-AI-007: an http(s) address is kept without trailing slashes; blank clears it; anything else is refused', () => {
    expect(readBaseUrl(' http://localhost:11434/v1/ ')).toBe('http://localhost:11434/v1');
    expect(readBaseUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1');
    expect(readBaseUrl('  ')).toBe('');
    expect(readBaseUrl('api.openai.com/v1')).toBeUndefined();
    expect(readBaseUrl('file:///etc/passwd')).toBeUndefined();
  });
});
