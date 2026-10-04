// The edit mode's body (split from the root, M7.24): the screens list, the canvas with the timeline, and the inspector.
import type { Store } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RenderRegistries } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useCallback } from 'react';
import type { AssetStore } from './asset-store.js';
import { screenToPage } from './camera.js';
import { Canvas } from './canvas.js';
import { type CanvasMenuInput, useCanvasMenu } from './canvas-menu.js';
import { ImagePicker } from './image-picker.js';
import type { EditorLayout } from './layout.js';
import { insertShape } from './library/library-insert.js';
import { Inspector, LeftTabs, Timeline } from './panels.js';
import { placeImageFiles } from './place-images.js';
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
  readonly screenId: RecordId | undefined;
  readonly area: Box | undefined;
  /** Where fresh record ids come from. */
  readonly newId: () => RecordId;
  /** Told the canvas's size. */
  readonly onBox: (box: { readonly w: number; readonly h: number }) => void;
  /** The canvas's size now (a library click inserts at the middle of it). */
  readonly box: { readonly w: number; readonly h: number };
  readonly layout: EditorLayout;
  readonly onLayout: (layout: EditorLayout) => void;
  /** What the context menus need besides the tools and the area. */
  readonly menus: Omit<CanvasMenuInput, 'tools' | 'area'>;
  /** The bytes of the document's assets, to put an imported image's bytes in. */
  readonly assetStore: AssetStore;
  /** Tell the person something (an image that was refused). */
  readonly notify: (message: string) => void;
};

/** The panels around the canvas. */
export function EditBody(props: EditBodyProps): ReactNode {
  const { store, registries, session, tools, execute, screenId, area, newId, onBox, box, layout, onLayout, menus, assetStore, notify } = props;
  const { panel, splitter } = usePanels(layout, onLayout);
  const { onMenu, menu } = useCanvasMenu({ ...menus, tools, area });
  // a library item put on the canvas: at the drop point, or at the middle of the view for a click
  const insert = useCallback(
    (defId: string, at?: Vec2) =>
      void insertShape(
        { view: store, screen: screenId, newId, execute, seal: () => store.history.seal(), session, shapeDefs: registries.shapeDefs },
        defId,
        at ?? screenToPage(session.camera.get(), { x: box.w / 2, y: box.h / 2 }),
      ),
    [store, screenId, newId, execute, session, registries, box],
  );
  // image files dropped on the canvas, or picked in the image picker: imported, then placed like a pasted image
  const importFiles = useCallback(
    (files: readonly File[], at?: Vec2) =>
      void placeImageFiles(
        { view: store, execute, seal: () => store.history.seal(), screen: screenId, newId, assets: assetStore },
        files,
        at ?? screenToPage(session.camera.get(), { x: box.w / 2, y: box.h / 2 }),
        notify,
      ).then((id) => {
        if (id !== undefined) session.selection.set([id]);
      }),
    [store, execute, screenId, newId, assetStore, session, box, notify],
  );
  return (
    <div className="fx-chrome-body">
      {panel(
        'left',
        <LeftTabs
          screens={{ store, session, shown: screenId, registries, execute, newId }}
          problems={{ store, session, execute }}
          notes={{ store, execute, screenId }}
          library={{ shapeDefs: registries.shapeDefs, onPick: (id) => insert(id) }}
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
          assets={assetStore.url}
          onBox={onBox}
          onMenu={onMenu}
          onDropShape={insert}
          onDropFiles={importFiles}
        />
        {splitter('bottom')}
        {panel('bottom', <Timeline />)}
      </div>
      {menu}
      <ImagePicker store={store} session={session} execute={execute} screenId={screenId} newId={newId} onImport={importFiles} />
      {splitter('right')}
      {panel('right', <Inspector session={session} fields={{ store, execute, shapeDefs: registries.shapeDefs }} />)}
    </div>
  );
}
