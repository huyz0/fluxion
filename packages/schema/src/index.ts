// Public entry of @fluxion/schema; the package comment is the dts banner in tsdown.config.ts.

export type { DiagnosticSeverity } from './diagnostics.js';
export { type AnyRecord, type DocumentFile, RECORD_TYPES, SCHEMA_VERSION, type UnknownRecord } from './document-file.js';
export type { FluxError, FluxErrorCode } from './errors.js';
export { compareKeys, type IndexKey, isIndexKey, keyBetween, nKeysBetween } from './fractional-index.js';
export { createId, ID_ALPHABET, ID_LENGTH, isGeneratedId, isRecordId, type Random, type RecordId, seededRandom } from './ids.js';
export type { Color, ColorTransform, ColorValue, GradientPaint, GradientStop, ImagePaint, Paint, TokenRef, TransformedToken } from './paint.js';
export type { Extensible, Meta } from './primitives.js';
export type {
  BehaviourRecord,
  CommentRecord,
  InteractionRecord,
  StepAnimation,
  StepRecord,
  Tagged,
  TimelineRecord,
  VariableRecord,
} from './records/behaviour.js';
export type { AnchorRef, AutoAnchor, BindingRecord, FloatingAnchor, NamedAnchor, PointAnchor, SideAnchor } from './records/binding.js';
export type { DocumentRecord, DocumentSettings } from './records/document.js';
export {
  type ComponentElement,
  type ConnectorElement,
  type ConnectorLabel,
  type CoreElementKind,
  type Crop,
  ELEMENT_KINDS,
  type ElementRecord,
  type FrameElement,
  type GroupElement,
  type ImageElement,
  isCoreElementKind,
  type Marker,
  type Markers,
  type PluginElement,
  type Route,
  type ShapeElement,
  type TextElement,
  type UnknownElement,
} from './records/element.js';
export type { AnchorDef, BoxedBase, ElementBase, Locks, Point, QualifiedName, Semantic } from './records/element-base.js';
export type { AssetRecord, PluginRefRecord, ResourceRecord, ThemeRecord } from './records/resources.js';
export { DEFAULT_SCREEN_SIZE, type Rect, type ScreenRecord, type Size } from './records/screen.js';
export { type Err, err, type Ok, ok, type Result } from './result.js';
export { checkRichText, MAX_RICH_TEXT_DEPTH, type RichTextDoc, type RichTextIssue, type RichTextMark, type RichTextNode } from './rich-text.js';
export type { Effect, FontStyle, Shadow, Stroke, Style, StyleNumber, StyleValue, Transform } from './style.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
