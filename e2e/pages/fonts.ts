import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect } from '../test.js';
import type { EditorPage } from './editor.js';

const FIXTURES = new URL('../../fixtures/fonts/', import.meta.url);
/** The bytes of a Roboto fixture: the stand-in a mocked Google route and an upload serve. */
export const robotoBytes = (weight: 400 | 700): Buffer => readFileSync(new URL(`roboto-${weight}.woff2`, FIXTURES));

/**
 * Answer Google Fonts from the page's own routes: the stylesheet names one Latin slice of `family`, the file is Roboto's bytes.
 * Nothing leaves the machine.
 */
export async function mockGoogleFonts(page: Page, family: string): Promise<{ readonly asked: () => string[] }> {
  const asked: string[] = [];
  await page.route('https://fonts.googleapis.com/**', (route) => {
    asked.push(route.request().url());
    const css = ['normal', 'italic']
      .flatMap((style) =>
        [400, 700].map(
          (weight) =>
            `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  src: url(https://fonts.gstatic.com/s/mock/v1/${style}-${weight}.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}`,
        ),
      )
      .join('\n');
    return route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: css });
  });
  await page.route('https://fonts.gstatic.com/**', (route) => {
    asked.push(route.request().url());
    const weight = route.request().url().includes('-700') ? 700 : 400;
    return route.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: robotoBytes(weight) });
  });
  return { asked: () => asked };
}

/** A new document with one selected text element. */
export async function selectedText(page: Page, editor: EditorPage, drag: (page: Page, editor: EditorPage, tool: string) => Promise<unknown>): Promise<void> {
  await editor.open('new');
  await drag(page, editor, 'Text');
  await expect(editor.elements).toHaveCount(1);
  await expect(editor.inspectorText).toHaveText('1 element selected');
}

/** The font family the first text element is drawn in. */
export const textFamily = (editor: EditorPage): Promise<string> =>
  editor.elements.first().evaluate((el) => getComputedStyle(el.querySelector('.fx-label') ?? el).fontFamily);

/** Open the Fonts dialog. */
export const openFonts = (editor: EditorPage) => editor.root.getByRole('button', { name: 'Fonts', exact: true }).click();
