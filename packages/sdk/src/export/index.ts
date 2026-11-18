// `@fluxion/sdk/export` (ADR-0056 item 4, FR-EXP-004, FR-EXT-001): what a pack's element view needs to draw itself on the svg
// surface. Re-exported from render at runtime with render kept external in this entry's build, so a pack reads the host's one
// `ExportContext` instance: a bundled copy would be another context, and its text would get no measured lines.

export type { ElementView, ElementViewProps } from '@fluxion/render';
export { ExportContext, type ExportText, type Svg, useExportText } from '@fluxion/render/svg';
