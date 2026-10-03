import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { FontPicker, type FontSources } from './font-picker.js';
import { newDocument } from './new-document.js';

const SOURCES: FontSources = {
  bundled: ['Inter', 'Source Serif 4', 'JetBrains Mono'],
  catalog: async () => [
    { family: 'Roboto', category: 'sans-serif' },
    { family: 'Lora', category: 'serif' },
  ],
  addGoogle: async (family) => ({ ok: true, family }),
  upload: async (file) => ({ ok: false, message: `${file.name} is not a font` }),
};

/** The picker over a new document, in the editor chrome. */
function Story(props: { readonly sources: FontSources }): ReactNode {
  const [core] = useState(() => createCore(newDocument(seededRandom(2))));
  return (
    <div className="fx-editor" style={{ position: 'relative', height: 420 }}>
      <style>{CHROME_CSS}</style>
      <FontPicker store={core.store} execute={core.execute} selection={[]} sources={props.sources} onClose={() => {}} />
    </div>
  );
}

const meta: Meta<typeof Story> = {
  title: 'Editor/Font picker',
  component: Story,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type StoryType = StoryObj<typeof Story>;

/** The three sources: bundled families with previews, the Google catalog, an upload. */
export const Default: StoryType = { args: { sources: SOURCES } };

/** A host without Google Fonts: no Google tab. */
export const WithoutGoogle: StoryType = { args: { sources: { bundled: SOURCES.bundled, upload: SOURCES.upload } } };
