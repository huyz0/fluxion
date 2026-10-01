import type { Locator, Page } from '@playwright/test';
import { expect } from '../test.js';

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
    await this.screens.first().waitFor();
  }
}
