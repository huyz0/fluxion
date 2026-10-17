import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxFileOf, fluxJsonOf } from './pages/flux-files.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { expect, test } from './test.js';

// NFR-SEC-004, FR-AI-007: a provider key the studio holds, with a provider prefix or none, is in IndexedDB and nowhere else: not in the saved
// `.flux`, the `.flux.html` or `.flux.json` made from it, the console, the diagnostic report, or localStorage, sessionStorage and cookies.
const PREFIXED = 'sk-ant-api03-Zk3Q9xT7mB2vLpR8sD4fG6hJ1nC5wY0a';
const PLAIN = 'k9x4f7a21c0b83de5961a7f4c2e8d0b3';

type Hooks = {
  holdKey(provider: string, value: string): Promise<void>;
  log(level: string, message: string, fields?: object): void;
  report(): string;
};

test.describe('no provider key leaks', { tag: '@desktop' }, () => {
  test('NFR-SEC-004: held keys are in IndexedDB only; no saved file, log line or diagnostic report holds one', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
    });
    const consoleText: string[] = [];
    page.on('console', (m) => consoleText.push(m.text()));
    await pickers(page, asPicker('deck.flux', await fluxFileOf('two-rects-line')));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await new EditorPage(page).screens.first().waitFor();

    await page.evaluate(
      async ([a, b]) => {
        const hooks = (window as unknown as { __fluxion: Hooks }).__fluxion;
        await hooks.holdKey('anthropic', a as string);
        await hooks.holdKey('local', b as string);
        hooks.log('error', `provider said no: ${a}`, { header: `Bearer ${b}` });
      },
      [PREFIXED, PLAIN],
    );

    // the positive control: the keys are really kept, in IndexedDB
    const kept = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open('fluxion-ai', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction('keys').objectStore('keys').getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result));
          };
        }),
    );
    expect(kept).toContain(PREFIXED);
    expect(kept).toContain(PLAIN);

    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const flux = (await writes(page))[0]?.bytes ?? new Uint8Array();
    const report = await page.evaluate(() => (window as unknown as { __fluxion: Hooks }).__fluxion.report());
    const web = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie, location.href]));

    const artifacts: Record<string, string> = {
      '.flux': Buffer.from(flux).toString('latin1'),
      '.flux.html': await fluxHtmlOfFlux(flux, 'Key leak'),
      '.flux.json': await fluxJsonOf(flux),
      console: consoleText.join('\n'),
      'diagnostic report': report,
      'web storage': web,
    };
    for (const [name, text] of Object.entries(artifacts)) {
      expect(text, name).not.toContain(PREFIXED);
      expect(text, name).not.toContain(PLAIN);
    }
    // the error was logged and shown, with the keys replaced
    expect(artifacts['console']).toContain('[redacted-key]');
  });
});
