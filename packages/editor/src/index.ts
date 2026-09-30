// Public entry of @fluxion/editor; the package comment is the dts banner in tsdown.config.ts.

export { handTool, registerBuiltinTools, selectTool } from './builtin-tools.js';
export {
  type Camera,
  clampZoom,
  FIT_PADDING,
  fitBox,
  pageToScreen,
  panBy,
  screenToPage,
  ZOOM_LIMITS,
  zoomAt,
  zoomBy,
  zoomTo100,
} from './camera.js';
export { EditorRoot, type EditorRootProps } from './editor-root.js';
export { createHitIndex, type HitContext, type HitIndex, PICK_PX } from './hit-test.js';
export { LAYOUT_KEY } from './layout.js';
export { newDocument } from './new-document.js';
export type { Execute, PointerInfo, PointerPhase } from './pointer.js';
export { createSession, createSessions, DEFAULT_CAMERA, type Session, type Sessions } from './session.js';
export { memorySettings, type SettingsStore } from './settings.js';
export {
  createToolDispatcher,
  createToolRegistry,
  type KeyInfo,
  SELECT_TOOL,
  type StateNode,
  type Tool,
  type ToolCtx,
  type ToolDispatcher,
  type Transition,
} from './tools.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
