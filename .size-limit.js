// Bundle budgets (NFR-SIZE-001, NFR-SIZE-002) come from scripts/gates/thresholds.mjs, the single
// source that check-drift protects. Paths are built library entries (run after `pnpm build`).
import { t } from './scripts/gates/thresholds.mjs';

const kB = (bytes) => `${Math.floor(bytes / 1000)} kB`;

export default [
  { name: 'player core', path: 'packages/player/dist/index.js', limit: kB(t('PLAYER_CORE_GZIP')), gzip: true },
  { name: 'editor initial', path: 'packages/editor/dist/index.js', limit: kB(t('EDITOR_INITIAL_GZIP')), gzip: true },
];
