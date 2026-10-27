import { expect, it } from 'vitest';
import { VERSION } from './index.js';

it('NFR-MNT-004 smoke: @fluxion/pack-network exports its version', () => {
  // the package version, which `changeset version` bumps and scripts/packs/sync-versions.mjs copies here (M18.110)
  const packageJson = import.meta.glob('../package.json', { query: '?raw', import: 'default', eager: true })['../package.json'] ?? '{}';
  expect(VERSION).toBe(JSON.parse(packageJson).version);
});
