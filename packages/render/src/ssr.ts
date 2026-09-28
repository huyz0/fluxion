// The static render path (ADR-0015 §1, FR-CLI-001): a document as one self-contained HTML page. Each
// visible screen is the live <ScreenView> in `export` mode rendered by react-dom/server's
// renderToStaticMarkup, so nothing is drawn twice; the content CSS is inlined and each screen
// carries its theme variables, so the page needs no script and no network.
import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { LIGHT_THEME, type Theme } from '@fluxion/theme';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { builtinRegistries } from './builtins.js';
import { CONTENT_CSS } from './content-css.js';
import { screenArea } from './fit.js';
import { modePolicy } from './mode-policy.js';
import type { RenderRegistries } from './registries.js';
import { screensInOrder } from './screen-order.js';
import { ScreenView } from './screen-view.js';

/**
 * Options of {@link renderDocumentToHtml}.
 *
 * @public
 */
export type RenderHtmlOptions = {
  /** Only these screens, in document order (default: every screen the export mode shows). */
  readonly screens?: readonly RecordId[];
  /** The theme (default: the light theme). */
  readonly theme?: Theme;
  /** Where element views are looked up (default: the built-ins). */
  readonly registries?: RenderRegistries;
};

/** The page around the screens: stacked, each at its own size, on a neutral backdrop. */
const PAGE_CSS =
  'body { margin: 0; background: #e5e7eb; } .fx-document { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px; }';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * `file` as a static HTML page: one `.fx-screen` per visible screen (or per requested screen), the
 * content CSS inlined in `<head>`, the theme's variables on each screen, and no script.
 *
 * @public
 */
export function renderDocumentToHtml(file: DocumentFile, options: RenderHtmlOptions = {}): string {
  const { store } = createCore(file);
  const theme = options.theme ?? LIGHT_THEME;
  const registries = options.registries ?? builtinRegistries();
  const { showHidden } = modePolicy('export');
  const wanted = options.screens === undefined ? undefined : new Set<string>(options.screens);
  const ids = store
    .query((view) => screensInOrder(view, showHidden))()
    .filter((id) => wanted === undefined || wanted.has(id));
  const screens = ids.map((id, index) => {
    const area = screenArea((store.get(id) ?? {}) as Parameters<typeof screenArea>[0]);
    const view = { kind: 'fit', box: { w: area.w, h: area.h } } as const;
    // each render restarts useId: a per-screen prefix keeps gradient and marker ids unique on the page
    const element = createElement(ScreenView, { store, screenId: id, mode: 'export', view, theme, registries });
    return renderToStaticMarkup(element, { identifierPrefix: `s${index}-` });
  });
  const title = Object.values(file.records).find((r) => r.type === 'document') as { readonly title?: string } | undefined;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title?.title ?? 'Fluxion document')}</title>`,
    `<style data-fx-content>${CONTENT_CSS}</style>`,
    `<style>${PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    `<main class="fx-document">${screens.join('')}</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
