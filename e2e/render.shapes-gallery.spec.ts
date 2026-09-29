import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './test.js';

// FR-SHP-002, FR-CON-002, FR-CON-003, T3 (testing.md §5 rule 14): the shapes gallery the built CLI
// writes (every basic shape, route type and marker, drawn from the bundled pack), screenshotted in the
// pinned Playwright image (CI's visual job). The page is loaded with setContent: it needs no network
// (no script, the content CSS inlined), so nothing leaves the test.
function galleryHtml(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-gallery-'));
  try {
    const out = join(dir, 'shapes-gallery.html');
    execFileSync(process.execPath, ['packages/cli/dist/bin.js', 'render', 'fixtures/docs/shapes-gallery.flux.json', '-o', out], { stdio: 'pipe' });
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('FR-SHP-002: the shapes gallery renders as its baseline on every desktop engine @visual', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.setContent(galleryHtml(), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const screen = page.locator('.fx-screen');
  await expect(screen).toHaveCount(1);
  // every shape is drawn by the pack: no placeholder
  await expect(page.locator('.fx-placeholder')).toHaveCount(0);
  await expect(screen).toHaveScreenshot('shapes-gallery.png');
});
