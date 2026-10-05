// Bundle budgets (NFR-SIZE-001, NFR-SIZE-002) come from scripts/gates/thresholds.mjs, the single
// source that check-drift protects. Paths are built library entries (run after `pnpm build`).
import { t } from './scripts/gates/thresholds.mjs';

const kB = (bytes) => `${Math.floor(bytes / 1000)} kB`;

export default [
  { name: 'player core', path: 'packages/player/dist/index.js', limit: kB(t('PLAYER_CORE_GZIP')), gzip: true },
  // the one-file player and the same script for a page that embeds <fluxion-player> (M11.47) are held to the PLAYER_CORE_GZIP threshold (NFR-SIZE-001, M11.18). The ratchet that
  // preceded it showed the growth: 224.01 kB gzip in M11.2 (docs/research/07-player-size.md), 162.91 kB once M11.28 took react-dom/server out, 167.18 kB at M11.13, 138.28 kB with the
  // lean reader and the inert zod of the script (ADR-0026 amendment, M11.42), 140.54 kB with touch (M11.15), 141.05 kB with the screen reader words (M11.16)
  { name: 'player-inline', path: 'packages/player-inline/dist/player.inline.js', limit: kB(t('PLAYER_CORE_GZIP')), gzip: true },
  { name: 'fluxion-player script', path: 'packages/player-inline/dist/fluxion-player.js', limit: kB(t('PLAYER_CORE_GZIP')), gzip: true },
  { name: 'editor initial', path: 'packages/editor/dist/index.js', limit: kB(t('EDITOR_INITIAL_GZIP')), gzip: true },
];
