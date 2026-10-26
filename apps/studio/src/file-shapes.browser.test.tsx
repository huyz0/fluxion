import { createCore } from '@fluxion/core';
import { createAssetStore } from '@fluxion/editor';
import { sha256Hex, writeFlux } from '@fluxion/format';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import './i18n.js';
import { FileBar } from './file-bar.js';
import { openFileBytes } from './file-session.js';

it('FR-LIB-009: a successful Save visibly warns that loaded unresolved geometry remains unavailable', async () => {
  const b = documentBuilder();
  const screen = b.screen();
  b.rect(screen, { defId: 'legacy:missing' });
  const documentFile = b.build();
  const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
  const archive = await writeFlux({ document: documentFile, appVersion: '0', hasher });
  if (!archive.ok) throw new Error(archive.error.reason);
  const opened = await openFileBytes('legacy.flux', archive.value, hasher);
  if (!opened.ok) throw new Error(opened.error);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const writes: Uint8Array[] = [];
  try {
    await act(async () =>
      root.render(
        <FileBar
          host={{
            canOverwrite: true,
            openFile: async () => undefined,
            writeOver: async (_handle, bytes) => {
              writes.push(bytes);
            },
            saveAs: async (name, bytes) => {
              writes.push(bytes);
              return { name };
            },
          }}
          store={createCore(documentFile).store}
          assets={createAssetStore()}
          entry={{ identity: 'legacy', file: opened.value, urls: new Map(), handle: {} }}
          onOpened={() => undefined}
        />,
      ),
    );
    const save = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Save');
    expect(save).toBeDefined();
    await act(async () => save?.click());
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => host.querySelector('[role="status"]')?.textContent).toContain('legacy:missing');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Saved');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
