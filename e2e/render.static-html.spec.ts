import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './test.js';

// FR-SCR-001, T3 (testing.md §5 rule 14): the static HTML the built CLI writes for two-rects-line,
// screenshotted in the pinned Playwright image (CI's visual job). The page is loaded with setContent:
// it needs no network (no script, the content CSS inlined), so nothing leaves the test.
function cliHtml(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-visual-'));
  try {
    const out = join(dir, `${fixture}.html`);
    execFileSync(process.execPath, ['packages/cli/dist/bin.js', 'render', `fixtures/docs/${fixture}.flux.json`, '-o', out], { stdio: 'pipe' });
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('FR-SCR-001: the CLI output of two-rects-line renders as its baseline @visual', async ({ page }) => {
  await page.setContent(cliHtml('two-rects-line'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const screen = page.locator('.fx-screen');
  await expect(screen).toHaveCount(1);
  await expect(screen).toHaveScreenshot('two-rects-line.png');
});
