import { EditorView } from '@codemirror/view';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CHROME_CSS } from '../chrome-css.js';
import { manualScheduler, moveOnCanvas, setup } from './source-fixture.js';
import { SourceView } from './source-view.js';

/** The source view of the first screen of a two-screen document, in the left panel's chrome. */
function SourceStory(props: { readonly changed?: boolean }): ReactNode {
  const [fixture] = useState(() => ({ ...setup(), timer: manualScheduler() }));
  const { store, execute, registries, one } = fixture;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.changed !== true || box.current === null) return;
    // a waiting text (the timer never runs) makes the view dirty, so the canvas change raises the banner
    const editor = EditorView.findFromDOM(box.current);
    editor?.dispatch({ changes: { from: editor.state.doc.length, insert: '# note\n' } });
    moveOnCanvas(fixture);
  }, [props.changed, fixture]);
  return (
    <div ref={box} className="fx-editor" style={{ position: 'relative', height: 480 }}>
      <style>{CHROME_CSS}</style>
      <aside aria-label="Left panel" className="fx-chrome-panel fx-chrome-left" style={{ width: 320, height: 460 }}>
        <SourceView store={store} execute={execute} registries={registries} screenId={one} scheduler={fixture.timer.scheduler} />
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

/** The canvas changed under a view with a waiting text: the text stays and the banner offers the reload. */
export const CanvasChanged: Story = { args: { changed: true } };
