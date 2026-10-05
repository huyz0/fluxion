// Bundle budgets (NFR-SIZE-001, NFR-SIZE-002) come from scripts/gates/thresholds.mjs, the single
// source that check-drift protects. Paths are built library entries (run after `pnpm build`).
import { t } from './scripts/gates/thresholds.mjs';

const kB = (bytes) => `${Math.floor(bytes / 1000)} kB`;

export default [
  { name: 'player core', path: 'packages/player/dist/index.js', limit: kB(t('PLAYER_CORE_GZIP')), gzip: true },
  // the one-file player (ADR-0154): a ratchet, so every later row shows its growth. Measured 224.01 kB gzip in M11.2 (docs/research/07-player-size.md), 162.91 kB
  // once M11.28 took react-dom/server out; M11.27 (the lean reader) lowers it again and M11.18 replaces it with the PLAYER_CORE_GZIP threshold (NFR-SIZE-001)
  { name: 'player-inline', path: 'packages/player-inline/dist/player.inline.js', limit: '165 kB', gzip: true },
  { name: 'editor initial', path: 'packages/editor/dist/index.js', limit: kB(t('EDITOR_INITIAL_GZIP')), gzip: true },
];
