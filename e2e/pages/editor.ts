import type { Locator, Page } from '@playwright/test';

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
