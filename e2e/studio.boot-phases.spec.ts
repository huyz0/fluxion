import { bootReport, EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// M19.29: the studio marks each boot step, so a first screen that does not come says where the boot stopped
test.describe('studio boot phases', () => {
  test('NFR-PORT-001: opening the editor marks start, lock, packs and editor in order, and a busy root says what it waits on', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const report = await bootReport(page);
    const marks = /marks (\S+@\d+) (\S+@\d+) (\S+@\d+) (\S+@\d+);/.exec(report);
    expect(
      marks?.slice(1).map((m) => m.split('@')[0]),
      report,
    ).toEqual(['start', 'lock', 'packs', 'editor']);
    const times = (marks?.slice(1) ?? []).map((m) => Number(m.split('@')[1]));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(report).toContain('waiting on nothing');
    // held at the document lock (another tab's), the root names it
    await page.evaluate(() => {
      const main = document.createElement('main');
      main.setAttribute('data-testid', 'studio-root');
      main.setAttribute('aria-busy', 'true');
      main.setAttribute('data-boot', 'lock');
      document.body.append(main);
    });
    expect(await bootReport(page)).toContain('waiting on lock');
  });

  test('NFR-PORT-001: a first screen that never comes fails open() before the test timeout, with the boot report read from the page', async ({ page }) => {
    // a short test budget (never a longer one): open() must stop in time to read the page
    test.setTimeout(15_000);
    // the autosave database never answers, so the document lock never settles
    await page.addInitScript(() => {
      IDBFactory.prototype.open = () => ({}) as IDBOpenDBRequest;
    });
    const failure = await new EditorPage(page).open('new').then(
      () => 'opened',
      (error: unknown) => String(error),
    );
    expect(failure).toMatch(/studio boot: marks start@\d+; waiting on lock;/);
    const note = test.info().annotations.find((a) => a.type === 'boot-phases');
    expect(note?.description).toMatch(/^marks start@\d+; waiting on lock;/);
  });
});
