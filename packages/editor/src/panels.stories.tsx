import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { Inspector, LeftTabs, Timeline } from './panels.js';
import { createSession } from './session.js';

/** One of the editor's panels, in the chrome's CSS. */
function PanelStory(props: { readonly panel: 'left' | 'right' | 'bottom'; readonly selected: number }): ReactNode {
  const session = createSession('story');
  session.selection.set(Array.from({ length: props.selected }, (_, i) => `sel${i}` as never));
  const names = { left: 'Screens, library and layers', right: 'Inspector', bottom: 'Timeline' } as const;
  const content = { left: <LeftTabs />, right: <Inspector session={session} />, bottom: <Timeline /> }[props.panel];
  const Tag = props.panel === 'bottom' ? 'section' : 'aside';
  return (
    <div className="fx-editor" style={{ position: 'relative', height: 320 }}>
      <style>{CHROME_CSS}</style>
      <Tag aria-label={names[props.panel]} className={`fx-chrome-panel fx-chrome-${props.panel}`} style={{ width: 280, height: 300 }}>
        {content}
      </Tag>
    </div>
  );
}

const meta: Meta<typeof PanelStory> = {
  title: 'Editor/Panels',
  component: PanelStory,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type Story = StoryObj<typeof PanelStory>;

/** The left panel: screens, library and layers tabs. */
export const Left: Story = { args: { panel: 'left', selected: 0 } };

/** The inspector with nothing selected. */
export const InspectorEmpty: Story = { args: { panel: 'right', selected: 0 } };

/** The inspector with a multiple selection. */
export const InspectorSelection: Story = { args: { panel: 'right', selected: 3 } };

/** The timeline's placeholder. */
export const TimelinePanel: Story = { args: { panel: 'bottom', selected: 0 } };
