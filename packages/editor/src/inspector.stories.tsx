import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { InspectorFields } from './inspector.js';
import { createSession } from './session.js';

/** The kinds of selection a story shows the inspector for. */
type Variant = 'mixed' | 'gradient' | 'one';

/** The inspector's fields for a small document with a selection of the given kind, in the chrome's CSS. */
function InspectorStory(props: { readonly variant: Variant }): ReactNode {
  const [{ core, session }] = useState(() => {
    const b = documentBuilder({ seed: 31 });
    const s = b.screen({ size: { w: 800, h: 600 } });
    const gradient = {
      type: 'linear-gradient',
      angle: 0,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    const ids: RecordId[] = [
      b.rect(s, { x: 10, y: 10, w: 100, h: 50, style: { fill: props.variant === 'gradient' ? (gradient as never) : '#ff0000' } }),
      b.rect(s, { x: 200, y: 10, w: 100, h: 60, style: { fill: '#00ff00', opacity: 0.5 } }),
      b.rect(s, { x: 400, y: 10, w: 100, h: 70, style: { fill: '#0000ff' } }),
    ];
    const core = createCore(b.build());
    const session = createSession('story');
    session.selection.set(props.variant === 'mixed' ? ids : ids.slice(0, 1));
    return { core, session };
  });
  return (
    <div className="fx-editor" style={{ position: 'relative', width: 320 }}>
      <style>{CHROME_CSS}</style>
      <aside aria-label="Inspector" className="fx-chrome-panel" style={{ position: 'static' }}>
        <InspectorFields store={core.store} session={session} execute={core.execute} />
      </aside>
    </div>
  );
}

const meta: Meta<typeof InspectorStory> = {
  title: 'Editor/Inspector',
  component: InspectorStory,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type Story = StoryObj<typeof InspectorStory>;

/** Three shapes selected: the fill and opacity differ ("Mixed"), the shared width shows its value; scrub, type, slide or click to set all three. */
export const MixedSelection: Story = { args: { variant: 'mixed' } };

/** One shape with a gradient fill: shown as a gradient with a preview, not as none. */
export const GradientFill: Story = { args: { variant: 'gradient' } };

/** One shape: number fields (arrow keys step them), the fit as an icon per option, the colour box with the theme's tokens. */
export const OneShape: Story = { args: { variant: 'one' } };
