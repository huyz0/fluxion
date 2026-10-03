import { composeStories } from '@storybook/react-vite';
import axe from 'axe-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as stories from './theme-switcher.stories.js';

// Every story is a browser test (testing.md T1): each composed story (args, decorators) renders in
// Chromium, runs its play function if it has one, and is checked with axe. Portable stories, not
// @storybook/addon-vitest (Vitest 5; ADR-0139). A new story in the file is tested automatically.
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

it.each(Object.entries(composeStories(stories)))('NFR-MNT-004 story Editor/Theme switcher/%s renders with 0 axe violations', async (_name, Story) => {
  await act(async () => root.render(<Story />));
  if (Story.play) await act(async () => Story.play?.({ canvasElement: host }));
  expect(host.childElementCount).toBeGreaterThan(0);
  const { violations } = await axe.run(host);
  expect(violations.map((v) => v.id)).toEqual([]);
});
