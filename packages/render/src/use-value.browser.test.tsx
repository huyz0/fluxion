import { computed, createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useValue } from './use-value.js';

// 04 §2.3: a component subscribes to the smallest signal it renders and re-renders when it changes
it('useValue re-renders on a change of the signal it reads, and only then', async () => {
  const b = documentBuilder({ seed: 401 });
  const a = b.rect(b.screen());
  const core = createCore(b.build());
  const name = computed(() => (core.store.record$(a)() as { name?: string } | undefined)?.name ?? '-');
  let renders = 0;
  function Name(): string {
    renders++;
    return useValue(name);
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Name />));
  expect(host.textContent).toBe('-');
  const before = renders;
  await act(async () => {
    core.execute('element.update', { id: a, fields: { name: 'Server' } });
  });
  expect(host.textContent).toBe('Server');
  expect(renders).toBeGreaterThan(before);
  // a change to another record does not re-render
  const settled = renders;
  await act(async () => {
    core.execute('document.update', { fields: { title: 'x' } });
  });
  expect(renders).toBe(settled);
  act(() => root.unmount());
  host.remove();
});
