// The edit mode's body (split from the root, M7.24): the screens list, the canvas with the timeline, and the inspector.
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import type { RenderRegistries } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import type { ReactNode } from 'react';
import { Canvas } from './canvas.js';
import { type CanvasMenuInput, useCanvasMenu } from './canvas-menu.js';
import { ImagePicker } from './image-picker.js';
import type { EditorLayout } from './layout.js';
import { Inspector, LeftTabs, Timeline } from './panels.js';
import type { Execute } from './pointer.js';
import { usePanels } from './root-hooks.js';
import type { Session } from './session.js';
import type { ToolDispatcher } from './tools.js';

/** Props of {@link EditBody}. */
export type EditBodyProps = {
  readonly store: Store;
  readonly registries: RenderRegistries;
  readonly session: Session;
  readonly tools: ToolDispatcher;
  readonly execute: Execute;
  /** The bytes of the document's assets, by asset id. */
  readonly assets: (id: RecordId) => string | undefined;
  readonly screenId: RecordId | undefined;
  readonly area: Box | undefined;
  /** Where fresh record ids come from. */
  readonly newId: () => RecordId;
  /** Told the canvas's size. */
  readonly onBox: (box: { readonly w: number; readonly h: number }) => void;
  readonly layout: EditorLayout;
  readonly onLayout: (layout: EditorLayout) => void;
  /** What the context menus need besides the tools and the area. */
  readonly menus: Omit<CanvasMenuInput, 'tools' | 'area'>;
};

/** The panels around the canvas. */
export function EditBody(props: EditBodyProps): ReactNode {
  const { store, registries, session, tools, execute, assets, screenId, area, newId, onBox, layout, onLayout, menus } = props;
  const { panel, splitter } = usePanels(layout, onLayout);
  const { onMenu, menu } = useCanvasMenu({ ...menus, tools, area });
  return (
    <div className="fx-chrome-body">
      {panel(
        'left',
        <LeftTabs
          screens={{ store, session, shown: screenId, registries, execute, newId }}
          problems={{ store, session, execute }}
          notes={{ store, execute, screenId }}
        />,
      )}
      {splitter('left')}
      <div className="fx-chrome-center">
        <Canvas
          store={store}
          registries={registries}
          screenId={screenId}
          area={area}
          session={session}
          tools={tools}
          execute={execute}
          assets={assets}
          onBox={onBox}
          onMenu={onMenu}
        />
        {splitter('bottom')}
        {panel('bottom', <Timeline />)}
      </div>
      {menu}
      <ImagePicker store={store} session={session} execute={execute} screenId={screenId} newId={newId} />
      {splitter('right')}
      {panel('right', <Inspector session={session} fields={{ store, execute, shapeDefs: registries.shapeDefs }} />)}
    </div>
  );
}
