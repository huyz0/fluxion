import type { Locator, Page } from '@playwright/test';

/** Page object for the studio shell (e2e/pages: one object per screen, specs never use raw selectors). */
export class StudioPage {
  readonly page: Page;
  readonly root: Locator;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('studio-root');
    this.heading = page.getByRole('heading', { level: 1 });
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }
}
