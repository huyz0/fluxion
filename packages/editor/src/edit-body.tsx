// The edit mode's body (split from the root, M7.24): the screens list, the canvas with the timeline, and the inspector.
import type { CoreRegistries, Store } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import { type RenderRegistries, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type ReactNode, useCallback } from 'react';
import type { AssetStore } from './asset-store.js';
import { screenToPage } from './camera.js';
import { Canvas } from './canvas.js';
import './i18n.js';
import { type CanvasMenuInput, useCanvasMenu } from './canvas-menu.js';
import { connectorTypeInspectors } from './connector-types.js';
import { ImagePicker } from './image-picker.js';
import type { EditorLayout } from './layout.js';
import { type ArrangePort, LAYOUT_CHOICES, registeredLayoutIds } from './layout-arrange.js';
import type { OptionsSchemaOf } from './layout-options-form.js';
import { registeredTemplateIds } from './layout-picker.js';
import type { LibraryImporter } from './library/library-importer.js';
import { insertShape } from './library/library-insert.js';
import type { LibraryCatalog, LibraryPanelProps } from './library/library-panel.js';
import { replaceableShape, replaceSelectedShape } from './library/library-replace.js';
import { insertMyShape, type MyShapes, saveMyShape } from './library/my-shapes.js';
import { Inspector, LeftTabs, Timeline } from './panels.js';
import { placeImageFiles } from './place-images.js';
import type { Execute } from './pointer.js';
import { usePanels } from './root-hooks.js';
import type { Session } from './session.js';
import { followRemap } from './source-remap.js';
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
  /** The core registries the Source tab compiles against; without them the tab is a placeholder. */
  readonly sourceRegistries?: CoreRegistries | undefined;
  /** The options schema of a layout id, for the inspector's layout options form; no form without it. */
  readonly layoutOptionsSchema?: OptionsSchemaOf | undefined;
  /** The person's My shapes (FR-LIB-008); the library has no My shapes section without them. */
  readonly myShapes?: MyShapes | undefined;
  /** The host's layout worker, which the options form lays out in (M17.34). */
  readonly arrange?: ArrangePort | undefined;
  /** The host's SVG library import, behind the library panel's **Import SVG…** (M18.176). */
  readonly libraryImporter?: LibraryImporter | undefined;
  /** Definitions the library offers before they are loaded (M18.32); a pick or drop of one loads it first. */
  readonly catalog?: LibraryCatalog | undefined;
};

/** The left tabs: screens, problems, notes, the library (a pick inserts or replaces) and the Source tab when the host gives the core registries. */
function leftTabsFor(props: EditBodyProps, library: LibraryPanelProps, onRemap: (remap: ReadonlyMap<RecordId, RecordId>) => void): ReactNode {
  const { store, session, screenId, registries, execute, newId, sourceRegistries } = props;
  return (
    <LeftTabs
      screens={{ store, session, shown: screenId, registries, execute, newId }}
      problems={{ store, session, execute }}
      notes={{ store, execute, screenId }}
      library={library}
      source={sourceRegistries === undefined ? undefined : { store, execute, registries: sourceRegistries, screenId, onRemap }}
    />
  );
}

/** The inspector: the selection's fields, and the layout options form when the host gives the layouts' options schemas. */
function inspectorFor(props: EditBodyProps): ReactNode {
  const { store, session, execute, screenId, registries, layoutOptionsSchema, sourceRegistries, arrange } = props;
  const choices = [...LAYOUT_CHOICES.map(([name]) => name), ...registeredLayoutIds(sourceRegistries?.layouts.list() ?? [])];
  const templates = registeredTemplateIds(sourceRegistries?.templates.list() ?? []);
  return (
    <Inspector
      session={session}
      fields={{ store, execute, shapeDefs: registries.shapeDefs, inspectors: connectorTypeInspectors(registries.routers) }}
      layout={layoutOptionsSchema === undefined ? undefined : { store, execute, screenId, schemaOf: layoutOptionsSchema, choices, templates, arrange }}
    />
  );
}

/** Hand the browser `text` as a file named `name` to save. */
function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

/** The library's My shapes section: save the selection, insert an item at the middle of the view (selected), export and import. */
function mineFor(props: EditBodyProps, selection: readonly RecordId[]): LibraryPanelProps['mine'] {
  const { myShapes, store, session, tools, execute, screenId, newId, assetStore, box, notify } = props;
  if (myShapes === undefined) return undefined;
  const { available } = myShapes;
  return {
    myShapes,
    canSave: selection.length > 0,
    notify,
    onSave: (name) => {
      const source = {
        docId: session.docId,
        screen: screenId,
        endPoint: (id: RecordId, end: 'source' | 'target') => tools.ctx.route?.(id)?.[end].point,
        assetData: assetStore.url,
      };
      const saved = saveMyShape(store, selection, { id: newId(), name }, { source, available });
      if (!saved.ok) return saved;
      return myShapes.put(saved.value) ? saved : { ok: false, reason: 'there is no room for it' };
    },
    onInsert: (item) => {
      const deps = { view: store, execute, seal: () => store.history.seal(), screen: screenId, newId, assets: assetStore };
      const inserted = insertMyShape(deps, item, screenToPage(session.camera.get(), { x: box.w / 2, y: box.h / 2 }), available);
      if (inserted.ok) session.selection.set(inserted.value);
      else notify(t`${item.name} could not be inserted: ${inserted.reason}.`);
    },
    onExport: (text) => downloadText('my-shapes.json', text),
  };
}

/** The library panel's props: a pick inserts (or replaces the selected shape), with the host's importer, catalog and My shapes. */
function libraryFor(
  props: EditBodyProps,
  selection: readonly RecordId[],
  insert: (defId: string) => void,
  loaded: (defId: string, then: () => void) => void,
): LibraryPanelProps {
  const { registries, store, execute, session, catalog } = props;
  return {
    shapeDefs: registries.shapeDefs,
    onPick: (id) => insert(id),
    onReplace: (id) => loaded(id, () => void replaceSelectedShape({ view: store, execute, session, shapeDefs: registries.shapeDefs }, id)),
    canReplace: replaceableShape(store, selection) !== undefined,
    importer: props.libraryImporter,
    catalog: catalog?.entries,
    mine: mineFor(props, selection),
  };
}

/** The panels around the canvas. */
export function EditBody(props: EditBodyProps): ReactNode {
  const { store, registries, session, tools, execute, screenId, area, newId, onBox, box, layout, onLayout, menus, assetStore, notify } = props;
  const { panel, splitter } = usePanels(layout, onLayout);
  const { onMenu, menu } = useCanvasMenu({ ...menus, tools, area });
  // a library item put on the canvas: at the drop point, or at the middle of the view for a click
  const insertLoaded = useCallback(
    (defId: string, at?: Vec2) =>
      void insertShape(
        { view: store, screen: screenId, newId, execute, seal: () => store.history.seal(), session, shapeDefs: registries.shapeDefs },
        defId,
        at ?? screenToPage(session.camera.get(), { x: box.w / 2, y: box.h / 2 }),
      ),
    [store, screenId, newId, execute, session, registries, box],
  );
  // a catalog entry is loaded and registered first (M18.32); a definition already registered goes straight in
  const { catalog } = props;
  const loaded = useCallback(
    (defId: string, then: () => void) => {
      if (catalog === undefined || registries.shapeDefs.get(defId) !== undefined) then();
      else
        void catalog.ensure(defId).then((ok) => {
          if (ok) then();
        });
    },
    [catalog, registries],
  );
  const insert = useCallback((defId: string, at?: Vec2) => loaded(defId, () => insertLoaded(defId, at)), [loaded, insertLoaded]);
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
  const onRemap = useCallback((remap: ReadonlyMap<RecordId, RecordId>) => followRemap(session, remap), [session]);
  // a library pick replaces the selected shape when the panel's Replace toggle or a shift-click asks (FR-LIB-011)
  const selection = useValue(session.selection.get);
  const library = libraryFor(props, selection, insert, loaded);
  return (
    <div className="fx-chrome-body">
      {panel('left', leftTabsFor(props, library, onRemap))}
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
      {panel('right', inspectorFor(props))}
    </div>
  );
}
