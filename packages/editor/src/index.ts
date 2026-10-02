// Public entry of @fluxion/editor; the package comment is the dts banner in tsdown.config.ts.

export { type AssetStore, createAssetStore } from './asset-store.js';
export { handTool, registerBuiltinTools } from './builtin-tools.js';
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
export type { FitTargets } from './canvas-input.js';
export {
  type Clipboard,
  type ClipboardAsset,
  type ClipboardPayload,
  copyPayload,
  createClipboard,
  PASTE_OFFSET,
  type PasteDeps,
  type PastePlan,
  pasteInto,
  planPaste,
} from './clipboard.js';
export {
  CLIPBOARD_TYPE,
  MAX_PAYLOAD_CHARS,
  type ParsedOk,
  type ParsedPayload,
  type ParsedRefused,
  parsePayload,
  payloadHtml,
  payloadJson,
  payloadText,
  WEB_CLIPBOARD_TYPE,
} from './clipboard-format.js';
export {
  type ConnectorHandle,
  connectorHandleAt,
  connectorHandlesOf,
  endDrop,
  type RoutedEnd,
  type RoutedEnds,
  type RouteReader,
  waypointEdit,
} from './connector-handles.js';
export { connectorTool, createConnector, type Link } from './connector-tool.js';
export { type MenuItem, type MenuTarget, menuItems, menuTarget } from './context-menu-model.js';
export {
  type CreateDeps,
  type CreationSpec,
  createElement,
  creationTool,
  dragBox,
  type ElementMaker,
  frameMaker,
  frameTool,
  imageMaker,
  imageTool,
  type Placement,
  shapeMaker,
  shapeTool,
  textMaker,
  textTool,
} from './create-tool.js';
export {
  type CanvasSize,
  type CommandCanvas,
  type CommandHistory,
  commandMap,
  dispatchKey,
  EDITOR_COMMANDS,
  type EditorCommand,
  type EditorCommandCtx,
  type HistoryResult,
} from './editor-commands.js';
export { type EditorKeysInput, isEditable, useEditorKeys } from './editor-keys.js';
export { EditorRoot, type EditorRootProps } from './editor-root.js';
export { createHitIndex, type HitIndex, PICK_PX } from './hit-test.js';
export type { HitContext } from './hittable.js';
export {
  applyField,
  type InspectorCommand,
  type InspectorField,
  type InspectorGroup,
  type InspectorModel,
  type InspectorOverride,
  type Inspectors,
  inspect,
} from './inspector-model.js';
export {
  chordOf,
  DEFAULT_KEYMAP,
  EDIT_FLAGS,
  isModifierKey,
  type KeyBinding,
  type KeyPress,
  keymapConflicts,
  normalizeChord,
  PRESENT_FLAGS,
  resolveKey,
  toolBindings,
  whenHolds,
} from './keymap.js';
export {
  applyOverrides,
  assignKey,
  bindingId,
  formatChord,
  groupTitle,
  KEYMAP_KEY,
  type KeyGroup,
  type KeyOverrides,
  keyGroups,
  readOverrides,
  resetKey,
} from './keymap-overrides.js';
export { LASER_TRAIL, laserTool } from './laser-tool.js';
export { LAYOUT_KEY } from './layout.js';
export { newDocument } from './new-document.js';
export {
  ariaShortcuts,
  filterEntries,
  fuzzyScore,
  type PaletteAction,
  type PaletteEntry,
  type PaletteSource,
  paletteEntries,
  shortcutsOf,
} from './palette-model.js';
export { type ParamCommand, type PlacedParamHandle, paramEdit, paramHandleAt, paramHandlesOf, type ShapeDefs } from './param-handles.js';
export { FREEHAND_STEP_PX, freehandTool, MAX_PATH_POINTS, type PathBox, pathBox, penTool } from './path-tool.js';
export type { Execute, PointerInfo, PointerPhase } from './pointer.js';
export type { ModeSwitch } from './present.js';
export { type Problem, type ProblemFix, problemsOf } from './problems.js';
export { screenLabel, shownScreen, switchScreen } from './screen-switch.js';
export { selectSame } from './select-same.js';
export { deleteSelection, nudgeSelection, selectAll, selectTool } from './select-tool.js';
export { clickSelection, DRAG_PX, type Marquee, type MarqueeMode, marquee, sameStyle, sameType, union } from './selection.js';
export { createSession, createSessions, DEFAULT_CAMERA, type Session, type Sessions } from './session.js';
export { memorySettings, type SettingsStore } from './settings.js';
export { ROTATE_SNAP_STEP, SNAP_PX, type SnapGuide, type SnapKind, type SnapOptions, type SnapResult, snapAngle, snapBox, snapThreshold } from './snap/snap.js';
export { fitImage, type ImageSize, pasteSystemItem, type SystemItem, type SystemPasteDeps } from './system-paste.js';
export {
  createToolDispatcher,
  createToolRegistry,
  type KeyInfo,
  SELECT_TOOL,
  type StateNode,
  type Tool,
  type ToolCtx,
  type ToolDispatcher,
  type ToolMode,
  type Transition,
} from './tools.js';
export { CONTEXT_MENU_EVENT, moved, pinchCamera, TOUCH } from './touch.js';
export { readViewMeta, restoreView, snapshotView, type ViewMeta, withViewMeta } from './view-meta.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
