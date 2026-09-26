import { expect, it } from 'vitest';
import { VERSION } from './index.js';

// T1 smoke (NFR-MNT-004): the browser project runs in a real DOM
it('NFR-MNT-004 smoke: render runs in a real browser DOM', () => {
  const el = document.createElement('div');
  el.textContent = VERSION;
  document.body.append(el);
  expect(document.body.textContent).toContain('0.0.0');
  expect(navigator.userAgent).toMatch(/Chrome/);
});
