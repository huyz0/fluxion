import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { CHROME_CSS } from '../chrome-css.js';
import { setup } from './source-fixture.js';
import { SourceView } from './source-view.js';

/** The source view of the first screen of a two-screen document, in the left panel's chrome. */
function SourceStory(): ReactNode {
  const { store, execute, registries, one } = setup();
  return (
    <div className="fx-editor" style={{ position: 'relative', height: 480 }}>
      <style>{CHROME_CSS}</style>
      <aside aria-label="Left panel" className="fx-chrome-panel fx-chrome-left" style={{ width: 320, height: 460 }}>
        <SourceView store={store} execute={execute} registries={registries} screenId={one} />
      </aside>
    </div>
  );
}

const meta: Meta<typeof SourceStory> = {
  title: 'Editor/Source view',
  component: SourceStory,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type Story = StoryObj<typeof SourceStory>;

/** The FluxScript of a screen: the read-only header above its block. */
export const Screen: Story = {};
