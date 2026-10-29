// The testing entry of @fluxion/sdk (ADR-0193, ADR-0194): the shared suite a declarative shape pack's tests run.
// Its own module, so the renderer and the test builders stay out of the main entry.
export { type CheckedShapePack, checkShapePackFiles } from './pack-files.js';
export {
  type CheckedInShapePack,
  checkShapePack,
  type ShapePackExpectation,
  type ShapePackProblems,
  shapePackExpectation,
  UNRELEASED_PACK_VERSION,
} from './pack-suite.js';
export { type ShapePackGlobs, testShapePack } from './pack-test.js';
export { renderShapeGolden } from './shape-golden.js';
