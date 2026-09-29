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

  /** Open the document `docId` (`new`, or `example-<name>`) in the editor. */
  async open(docId: string): Promise<void> {
    await this.page.goto(`/edit/${docId}`);
    await this.screens.first().waitFor();
  }
}
