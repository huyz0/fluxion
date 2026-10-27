// The testing entry of @fluxion/sdk (ADR-0193): the shared suite a declarative shape pack's tests run.
// Its own module, so the renderer and the test builders stay out of the main entry.
export { buildShapePackFiles, type CheckedShapePack, checkShapePackFiles, type ShapePackDraft } from './pack-files.js';
export { renderShapeGolden } from './shape-golden.js';
