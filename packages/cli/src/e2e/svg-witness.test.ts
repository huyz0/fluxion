import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// the probe's seven cases in three processes at once (M19.59): the 128-observation session (~12 s) and the held-reply deadline
// (~10 s) each alone, the other five together; run one after another they took 28 s
const PARTS = [
  { args: ['--test-name-pattern', 'admits 128 observations'], pass: 1 },
  { args: ['--test-name-pattern', 'deadline rejects an explicitly held native reply'], pass: 1 },
  { args: ['--test-skip-pattern', 'admits 128 observations|deadline rejects an explicitly held native reply'], pass: 5 },
];

/** The installed-witness probe in a fresh directory outside the working tree, restricted by `args`; its exit status and output. */
function probe(args: readonly string[]): Promise<{ status: number | null; output: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-witness-e2e-'));
  copyFileSync(new URL('./fixtures/svg-witness-installed.mjs', import.meta.url), join(dir, 'probe.mjs'));
  copyFileSync(new URL('./fixtures/witness-diagnostics.mjs', import.meta.url), join(dir, 'witness-diagnostics.mjs'));
  copyFileSync(new URL('../../../format/src/__fixtures__/svg-paint-requests.json', import.meta.url), join(dir, 'requests.json'));
  copyFileSync(new URL('../../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', import.meta.url), join(dir, 'font.woff2'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...args, join(dir, 'probe.mjs')], {
      cwd: dir,
      timeout: 190000,
      env: {
        ...process.env,
        FLUXION_WITNESS_ENGINE: 'chromium',
        FLUXION_WITNESS_MODULE: new URL('../../dist/svg-witness.js', import.meta.url).href,
        FLUXION_WITNESS_THEME_MODULE: new URL('../../../theme/dist/index.js', import.meta.url).href,
        FLUXION_WITNESS_PLAYWRIGHT_MODULE: import.meta.resolve('playwright'),
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ status, output });
    });
  });
}

it('FR-LIB-004 NFR-SEC-001: built Node witness preserves native paint, containment and owned process lifecycle outside the working directory', {
  timeout: 200000,
}, async () => {
  const runs = await Promise.all(PARTS.map((part) => probe(part.args)));
  for (const [i, run] of runs.entries()) {
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain(`# pass ${PARTS[i]?.pass}`);
    expect(run.output).toContain('# fail 0');
  }
  // every case of the probe ran in exactly one part
  expect(PARTS.reduce((n, part) => n + part.pass, 0)).toBe(7);
});
