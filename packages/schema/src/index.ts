// Public entry of @fluxion/schema; the package comment is the dts banner in tsdown.config.ts.

export { checkedSchema, type NormalizedJson, type SameType } from './checked-schema.js';
export { DIAGNOSTIC_CODES, type Diagnostic, type DiagnosticCode, type DiagnosticSeverity, jsonPointer } from './diagnostics.js';
export {
  type AnyRecord,
  type DocumentFile,
  RECORD_TYPES,
  type RecordSchemaChoice,
  SCHEMA_VERSION,
  schemaForRecord,
  type UnknownRecord,
} from './document-file.js';
export { elementFields } from './element-fields.js';
export type { FluxError, FluxErrorCode } from './errors.js';
export { describeFields, type FieldDef, type FieldMeta } from './field-meta.js';
export { compareKeys, type IndexKey, isIndexKey, keyBetween, nKeysBetween } from './fractional-index.js';
export { createId, ID_ALPHABET, ID_LENGTH, isGeneratedId, isRecordId, type Random, type RecordId, seededRandom } from './ids.js';
export { MIGRATIONS, type Migrated, type Migration, migrate, type RawDocument } from './migrate.js';
export {
  type Color,
  type ColorTransform,
  type ColorValue,
  colorSchema,
  type GradientPaint,
  type GradientStop,
  type ImagePaint,
  isCssColor,
  type Paint,
  type TokenRef,
  type TransformedToken,
} from './paint.js';
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
  type TextFit,
  type UnknownElement,
} from './records/element.js';
export type { AnchorDef, BoxedBase, ElementBase, Locks, Point, QualifiedName, Semantic } from './records/element-base.js';
export { qualifiedNameSchema } from './records/element-base.js';
export { anchorDefSchema } from './records/element-schemas.js';
export type { AssetRecord, PluginRefRecord, ResourceRecord, ThemeRecord } from './records/resources.js';
export {
  DEFAULT_SCREEN_SIZE,
  presetOf,
  type Rect,
  SCREEN_PRESETS,
  type ScreenPreset,
  type ScreenRecord,
  type Size,
  screenKind,
  screenSize,
} from './records/screen.js';
export type { SectionRecord } from './records/section.js';
export { type Repaired, repair } from './repair.js';
export { type Err, err, type Ok, ok, type Result } from './result.js';
export { checkRichText, MAX_RICH_TEXT_DEPTH, type RichTextDoc, type RichTextIssue, type RichTextMark, type RichTextNode } from './rich-text.js';
export { canonicalNumber, type DocumentError, MAX_JSON_DEPTH, type ParsedDocument, parseDocument, serializeDocument } from './serialize.js';
export {
  type Effect,
  type FontStyle,
  type Shadow,
  type Stroke,
  type Style,
  type StyleNumber,
  type StyleValue,
  styleSchema,
  type Transform,
  transformRotation,
} from './style.js';
export { isValid, validate, validateRecord, validateReferences } from './validate.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
