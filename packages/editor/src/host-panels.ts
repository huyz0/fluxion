// What the editor's host gives its panels (split from editor-root.tsx for its size, M18.122): the Source tab's registries,
// the layout form, My shapes and their packs, arrange, the SVG importer and the catalog, passed through unchanged.
import type { EditBodyProps } from './edit-body.js';

/** The host props the panels read. */
type HostPanels = Pick<EditBodyProps, 'sourceRegistries' | 'layoutOptionsSchema' | 'myShapes' | 'myShapePacks' | 'arrange' | 'libraryImporter' | 'catalog'>;

/** Exactly the host props of `props` the panels read, so the editor passes no others down. */
export function hostPanels(props: HostPanels): HostPanels {
  const { sourceRegistries, layoutOptionsSchema, myShapes, myShapePacks, arrange, libraryImporter, catalog } = props;
  return { sourceRegistries, layoutOptionsSchema, myShapes, myShapePacks, arrange, libraryImporter, catalog };
}
