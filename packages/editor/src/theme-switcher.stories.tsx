import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { newDocument } from './new-document.js';
import { type ThemeChoice, ThemeSwitcher } from './theme-switcher.js';

const color = (value: string) => ({ $type: 'color', $value: value });
const THEMES: readonly ThemeChoice[] = [
  { name: 'light', tokens: { color: { background: color('#ffffff'), text: color('#111827') } } },
  { name: 'dark', tokens: { color: { background: color('#0b1020'), text: color('#e5e9f5') } } },
];

/** The switcher over a new document, in the toolbar's chrome, with the themes on offer. */
function Story(props: { readonly themes: readonly ThemeChoice[] }): ReactNode {
  const [core] = useState(() => createCore(newDocument(seededRandom(1))));
  const screen = core.store.members('byType', 'screen')[0];
  return (
    <div className="fx-editor" style={{ position: 'relative', height: 60 }}>
      <style>{CHROME_CSS}</style>
      <div className="fx-chrome-toolbar">
        <ThemeSwitcher store={core.store} execute={core.execute} themes={props.themes} screenId={screen} />
      </div>
    </div>
  );
}

const meta: Meta<typeof Story> = {
  title: 'Editor/Theme switcher',
  component: Story,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type StoryType = StoryObj<typeof Story>;

/** The document's theme and the open screen's override, over two themes. */
export const Default: StoryType = { args: { themes: THEMES } };

/** One theme on offer. */
export const OneTheme: StoryType = { args: { themes: THEMES.slice(0, 1) } };
