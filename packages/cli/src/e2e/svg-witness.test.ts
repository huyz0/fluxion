import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('FR-LIB-004 NFR-SEC-001: built Node witness preserves native paint, containment and owned process lifecycle outside the working directory', {
  timeout: 200000,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-witness-e2e-'));
  try {
    copyFileSync(new URL('./fixtures/svg-witness-installed.mjs', import.meta.url), join(dir, 'probe.mjs'));
    copyFileSync(new URL('../../../format/src/__fixtures__/svg-paint-requests.json', import.meta.url), join(dir, 'requests.json'));
    copyFileSync(new URL('../../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', import.meta.url), join(dir, 'font.woff2'));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(dir, 'probe.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 190000,
      env: {
        ...process.env,
        FLUXION_WITNESS_ENGINE: 'chromium',
        FLUXION_WITNESS_MODULE: new URL('../../dist/svg-witness.js', import.meta.url).href,
        FLUXION_WITNESS_THEME_MODULE: new URL('../../../theme/dist/index.js', import.meta.url).href,
        FLUXION_WITNESS_PLAYWRIGHT_MODULE: import.meta.resolve('playwright'),
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('# pass 7');
    expect(result.stdout).toContain('# skipped 0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
