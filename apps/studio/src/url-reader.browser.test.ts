import { afterEach, describe, expect, it, vi } from 'vitest';
import { urlReader } from './url-reader.js';

afterEach(() => vi.unstubAllGlobals());

describe('reading an external image for embedding (FR-AST-006)', () => {
  it('FR-AST-006: the request sends no credentials, no referrer, and refuses to follow a redirect', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await urlReader.read('https://cdn.example/a.png');
    expect(r.ok).toBe(true);
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  });

  it('FR-AST-006: a redirect (fetch rejects under redirect: error) is a failed read, not a followed one', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('redirect mode is set to error')));
    const r = await urlReader.read('https://cdn.example/a.png');
    expect(r.ok).toBe(false);
  });
});
