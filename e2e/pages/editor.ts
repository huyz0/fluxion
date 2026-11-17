import type { Locator, Page } from '@playwright/test';
import { expect, test, timeLeft } from '../test.js';

/** Page object for the editor (e2e/pages: one object per screen, specs never use raw selectors). */
export class EditorPage {
  readonly page: Page;
  readonly root: Locator;
  readonly canvas: Locator;
  readonly screens: Locator;
  readonly elements: Locator;
  readonly shapes: Locator;
  readonly placeholders: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('editor-root');
    this.canvas = page.getByRole('main', { name: 'Canvas' });
    this.screens = this.canvas.locator('.fx-screen');
    this.elements = this.canvas.locator('.fx-el');
    this.shapes = this.canvas.locator('.fx-el[data-kind="shape"]');
    this.placeholders = this.canvas.locator('.fx-placeholder');
  }

  /** The chrome panel labelled `name` (Screens, library and layers; Inspector; Timeline). */
  panel(name: string): Locator {
    return this.root.getByRole(name === 'Timeline' ? 'region' : 'complementary', { name, exact: true });
  }

  /** The theme editor beside the canvas (M20.11), once Edit theme opened it. */
  get themeEditor(): Locator {
    return this.root.getByRole('dialog', { name: 'Theme editor', exact: true });
  }

  /** The splitter labelled `name`, e.g. "Resize the left panel". */
  splitter(name: string): Locator {
    return this.root.getByRole('separator', { name });
  }

  /** The toolbar button named `name` (a panel's name, or "Focus mode"). */
  toolbarButton(name: string): Locator {
    return this.root.getByRole('button', { name, exact: true });
  }

  /** The zoom as the toolbar shows it, e.g. "100 %". */
  get zoomValue(): Locator {
    return this.root.getByRole('group', { name: 'Zoom' }).locator('output');
  }

  /** A zoom control: "Zoom in", "Zoom out", "Fit" or "100 %". */
  zoomButton(name: string): Locator {
    return this.root.getByRole('group', { name: 'Zoom' }).getByRole('button', { name, exact: true });
  }

  /** A tool's toolbar button: "Select", "Hand", … */
  toolButton(name: string): Locator {
    return this.root.getByRole('group', { name: 'Tools' }).getByRole('button', { name, exact: true });
  }

  /** What the inspector says about the selection. */
  get inspectorText(): Locator {
    return this.panel('Inspector').locator('p[aria-live]');
  }

  /** The Screens tab's button for the screen named `name`; pressed while that screen is shown. */
  screenTab(name: string): Locator {
    return this.root.getByRole('list', { name: 'Screens' }).getByRole('button', { name, exact: true });
  }

  /** The keyboard shortcuts dialog (`?`). */
  get keymapDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  }

  /** The drawn element with this record id. */
  element(id: string): Locator {
    return this.canvas.locator(`.fx-el[data-el-id="${id}"]`);
  }

  /** Open the side panels a first visit on a phone starts collapsed (FR-EDT-019). */
  async showSidePanels(): Promise<void> {
    for (const name of ['Screens, library and layers', 'Inspector']) {
      const button = this.toolbarButton(name);
      if ((await button.getAttribute('aria-pressed')) === 'false') await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }

  /** The first screen's box on the page. */
  async screenBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.screens.first().boundingBox();
    if (box === null) throw new Error('the screen is not laid out');
    return box;
  }

  /** The canvas's centre on the page. */
  async canvasCentre(): Promise<{ x: number; y: number }> {
    const box = await this.canvas.boundingBox();
    if (box === null) throw new Error('the canvas is not laid out');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Open the document `docId` (`new`, or `example-<name>`) in the editor. */
  async open(docId: string): Promise<void> {
    await this.page.goto(`/edit/${docId}`);
    try {
      // stops short of the test's timeout, which closes the page before the report below could read it
      const timeout = timeLeft(test.info());
      await this.screens.first().waitFor(timeout === undefined ? {} : { timeout });
    } catch (error) {
      // a first screen that never came says where the boot stopped (M19.29): the studio's boot marks and what it was waiting on
      const boot = await bootReport(this.page);
      test.info().annotations.push({ type: 'boot-phases', description: boot });
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nstudio boot: ${boot}`);
    }
  }
}

/**
 * Where the studio's boot stands on `page` (M19.29): each boot mark's time in ms since navigation (apps/studio/src/boot-phase.ts), what a
 * busy studio root waits on (`lock`: the document lock; `packs`: the document's packs or the first-party pack connectors), and the
 * resources still loading or last to finish. Never throws: a page that cannot answer says so.
 */
export async function bootReport(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const marks = performance
        .getEntriesByType('mark')
        .filter((m) => m.name.startsWith('fluxion:boot:'))
        .map((m) => `${m.name.slice('fluxion:boot:'.length)}@${Math.round(m.startTime)}`);
      const busy = document.querySelector('[data-testid="studio-root"][aria-busy="true"]');
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const last = [...resources]
        .sort((a, b) => b.responseEnd - a.responseEnd)
        .slice(0, 3)
        .map((r) => `${new URL(r.name).pathname}@${Math.round(r.responseEnd)}`);
      return [
        `marks ${marks.join(' ') || 'none'}`,
        `waiting on ${busy === null ? 'nothing (no busy studio root)' : (busy.getAttribute('data-boot') ?? 'unknown')}`,
        `now ${Math.round(performance.now())}`,
        `${resources.length} resources, last ${last.join(' ') || 'none'}`,
      ].join('; ');
    })
    .catch((error: unknown) => `unreadable (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`);
}
