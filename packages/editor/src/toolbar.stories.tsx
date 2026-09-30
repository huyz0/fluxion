import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
import { registerBuiltinTools } from './builtin-tools.js';
import { ZoomControls } from './canvas.js';
import { CHROME_CSS } from './chrome-css.js';
import { DEFAULT_LAYOUT, type EditorLayout } from './layout.js';
import { newDocument } from './new-document.js';
import { ToolButtons, Toolbar } from './panels.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

/** The chrome's CSS and a relative editor box, so a story draws as in the editor. */
function Chrome(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="fx-editor" style={{ position: 'relative', height: 80 }}>
      <style>{CHROME_CSS}</style>
      {props.children}
    </div>
  );
}

/** The toolbar with the built-in tools and the zoom controls, its layout kept in state. */
function ToolbarStory(props: { readonly layout: EditorLayout }): ReactNode {
  const [layout, setLayout] = useState(props.layout);
  const [{ session, tools, store }] = useState(() => {
    const session = createSession('story');
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    const store = createCore(newDocument(seededRandom(1))).store;
    const tools = createToolDispatcher(registry, {
      session,
      view: {} as never,
      screen: undefined,
      newId: () => 'new' as never,
      hitTest: () => undefined,
      elementsIn: () => [],
      allElements: () => [],
      execute: () => ({ ok: true, value: undefined }),
      seal: () => {},
    });
    return { session, tools, store };
  });
  return (
    <Chrome>
      <Toolbar layout={layout} onLayout={setLayout}>
        <ToolButtons session={session} tools={tools} />
        <ZoomControls store={store} session={session} box={{ w: 800, h: 600 }} area={{ x: 0, y: 0, w: 1920, h: 1080 }} />
      </Toolbar>
    </Chrome>
  );
}

const meta: Meta<typeof ToolbarStory> = {
  title: 'Editor/Toolbar',
  component: ToolbarStory,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type Story = StoryObj<typeof ToolbarStory>;

/** A first visit: the side panels shown, the timeline collapsed. */
export const Default: Story = { args: { layout: DEFAULT_LAYOUT } };

/** Focus mode: every panel hidden. */
export const Focus: Story = { args: { layout: { ...DEFAULT_LAYOUT, focus: true } } };
