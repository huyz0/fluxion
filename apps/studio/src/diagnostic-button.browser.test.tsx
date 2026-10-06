import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import './i18n.js';
import { DiagnosticButton } from './diagnostic-button.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the diagnostic button (NFR-OBS-002)', () => {
  it('NFR-OBS-002: Copy diagnostic report puts the report on the clipboard and says so, or says it could not', async () => {
    const b = documentBuilder({ seed: 9, title: 'ZXQ-TITLE-SENTINEL' });
    const s = b.screen({ name: 'ZXQ-NAME-SENTINEL' });
    b.text(s, 'ZXQ-TEXT-SENTINEL');
    const core = createCore(b.build());
    const written: string[] = [];
    await act(async () =>
      root.render(
        <DiagnosticButton
          store={core.store}
          write={async (text) => {
            written.push(text);
          }}
        />,
      ),
    );
    await act(async () => host.querySelector('button')?.click());
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain('SENTINEL');
    expect(JSON.parse(written[0] ?? '').document.byType).toMatchObject({ screen: 1, element: 1 });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Diagnostic report copied.');
    await act(async () =>
      root.render(
        <DiagnosticButton
          store={core.store}
          write={async () => {
            throw new Error('denied');
          }}
        />,
      ),
    );
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe('The diagnostic report could not be copied.');
  });
});
