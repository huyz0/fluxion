import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { MetadataDialog } from './metadata-dialog.js';
import { newDocument } from './new-document.js';

/** The dialog over a new document, with metadata already set when `filled`. */
function Story(props: { readonly filled: boolean }): ReactNode {
  const [core] = useState(() => {
    const c = createCore(newDocument(seededRandom(4)));
    if (props.filled)
      c.execute('document.updateMeta', {
        fields: {
          title: 'Quarterly review',
          description: 'Numbers for Q3',
          lang: 'en',
          authors: ['Ada', 'Grace'],
          tags: ['finance'],
          custom: { team: 'finance', ref: '7' },
        },
        modified: '2026-05-06T07:08:09Z',
      });
    return c;
  });
  return (
    <div className="fx-editor" style={{ position: 'relative', height: 560 }}>
      <style>{CHROME_CSS}</style>
      <MetadataDialog store={core.store} execute={core.execute} onClose={() => {}} />
    </div>
  );
}

const meta: Meta<typeof Story> = {
  title: 'Editor/Document details',
  component: Story,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type StoryType = StoryObj<typeof Story>;

/** A new document: every field empty. */
export const Empty: StoryType = { args: { filled: false } };

/** A document with its title, description, language, authors, tags and custom fields. */
export const Filled: StoryType = { args: { filled: true } };
