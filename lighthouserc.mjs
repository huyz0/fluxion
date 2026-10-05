// Lighthouse CI for the editor (NFR-SIZE-002, M11.19): the built studio is served by `vite preview` and opened on Lighthouse's desktop preset, three times; the median time
// to interactive must be at or under EDITOR_TTI_MS from scripts/gates/thresholds.mjs, the one source check-drift protects. The ci.yml `lighthouse` job runs
// `lhci autorun` with this file, and check-ci-evidence.mjs requires that job to be green.
import { t } from './scripts/gates/thresholds.mjs';

const PORT = 4317;

export default {
  ci: {
    collect: {
      url: [`http://localhost:${PORT}/`],
      numberOfRuns: 3,
      startServerCommand: `pnpm --filter @fluxion/studio exec vite preview --port ${PORT} --strictPort`,
      startServerReadyPattern: 'Local',
      startServerReadyTimeout: 60_000,
      settings: { preset: 'desktop', onlyCategories: ['performance'], chromeFlags: '--no-sandbox --headless=new' },
    },
    assert: {
      assertions: {
        interactive: ['error', { maxNumericValue: t('EDITOR_TTI_MS'), aggregationMethod: 'median' }],
      },
    },
  },
};
