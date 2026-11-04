// FR-LIB-009 (M18.261, cp41 F5): a first-party pack read that rejects is handled by the studio's catalog hook.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackCatalog } from './pack-catalog.js';
import { useDocumentCatalog } from './use-document-catalog.js';

const none: readonly { readonly id: string }[] = [];

function Probe({ read }: { read: () => Promise<PackCatalog> }) {
  useDocumentCatalog(undefined, none, read);
  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the studio catalog hook (FR-LIB-009)', () => {
  it('FR-LIB-009, FR-LIB-007: WHEN the first-party packs cannot be read THE SYSTEM SHALL log it and leave no unhandled rejection', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let rejected = false;
    const read = () =>
      Promise.reject(new Error('pack index unreadable')).finally(() => {
        rejected = true;
      });
    try {
      await act(async () => root.render(<Probe read={read} />));
      await expect.poll(() => rejected).toBe(true);
      await expect.poll(() => errors.mock.calls.flat().join(' ')).toContain('the first-party packs could not be read');
      // a rejection nobody handles is reported on the next macrotask; give it two
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      act(() => root.unmount());
      host.remove();
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });
});
