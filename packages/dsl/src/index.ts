/**
 * `@fluxion/dsl` — FluxScript parser, compiler, decompiler, diagnostics, Mermaid/Markdown importers.
 *
 * @packageDocumentation
 */

export { compile } from './compile.js';
export { decompile, decompileScreen } from './decompile/decompile.js';
export { DSL_CODES, type DslCode, type DslCodeEntry } from './diagnostics/codes.js';
export { formatDiagnostics } from './diagnostics/format.js';
export { type ExpandOptions, type ExpandResult, expandFlux } from './expand/expand.js';
export { EDGE_OPS, type Edge, type EdgeEnd, type EdgeOp, type EdgeResult, edgeDiagnostic, parseEdge, parseEdgeObject } from './parse/edge.js';
export { type ParseResult, parseFlux, type YEntry, type YMap, type YNode, type YScalar, type YSeq } from './parse/parse.js';
export { type PlaceInput, type PlaceOptions, type PlaceResult, placeFlux } from './place/place.js';
export type { EdgeAst, FluxAst, GroupAst, LayoutAst, Located, LocatedStyle, NodeAst, PinAst, ScreenAst, StyleAst, ThemeAst } from './read/ast.js';
export { type FluxScriptKeyLevel, type FluxScriptKeyTable, fluxScriptKeys } from './read/fields.js';
export { type ReadResult, readFlux } from './read/read.js';
export { type Resolution, type ResolveResult, resolveFlux } from './resolve/resolve.js';
export { editDistance, nearest, toSlug } from './resolve/suggest.js';
export {
  createStreamCompiler,
  type StreamCompiler,
  type StreamPart,
  type StreamScreen,
  type StreamUpdate,
} from './stream/compile-stream.js';
export { createStreamSplitter, type ScreenBlock, type SplitOutput, type StreamSplitter } from './stream/split.js';
export { type NamedHeader, upsertScreens } from './stream/upsert.js';
export type { CompileOptions, CompileResult, DecompileOptions, DecompileResult, DslDiagnostic, SourceRange } from './types.js';
export { type ValidateInput, type ValidateOptions, type ValidateResult, validateFlux } from './validate/validate.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
export { patchJsonSchema, strictPatchJsonSchema } from './patch/json-schema.js';
export {
  type AiPatch,
  aiPatchSchema,
  type EdgeSpec,
  type LayoutIntent,
  MAX_PATCH_OPS,
  NODE_SPEC_KEYS,
  type NodeSpec,
  type PatchOp,
  type Selector,
  type StyleSpec,
} from './patch/schema.js';
