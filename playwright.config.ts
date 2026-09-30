import { defineConfig, devices } from '@playwright/test';

// E2E preset (testing.md §5 rule 14, §7). Five projects. The visual preset (1280x800, dsf 1) is the
// desktop projects' own; mobile presets bring their device viewport, so @visual specs are desktop-only.
// Retries are detect-only: a retried pass is reported as flaky by scripts/ci/flake-report.mjs (M1.20).
// not vite preview's default 4173, so a preview of another project is never reused by mistake
const PORT = 4317;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    // desktops skip @mobile specs: touch input (fingers) is the phones'
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, grepInvert: /@mobile|@perf/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, grepInvert: /@mobile|@perf/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, grepInvert: /@mobile|@perf/ },
    // phones skip the visual baselines (desktop-sized) and @desktop specs, whose input (wheel, mouse
    // buttons, hover) a touch device does not have; touch input has its own specs (touch.*)
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, grepInvert: /@visual|@desktop|@perf/ },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] }, grepInvert: /@visual|@desktop|@perf/ },
    // benchmarks (@perf) measure frames: their own chromium project, run alone with one worker
    // (`playwright test --project=perf --workers=1`; m6-complete's perf group), never in the shards
    { name: 'perf', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, grep: /@perf/ },
  ],
  webServer: {
    // the built studio (testing.md T2), not the dev server
    command: `pnpm --filter @fluxion/studio run build && pnpm --filter @fluxion/studio exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
