/**
 * `@fluxion/dsl` — FluxScript parser, compiler, decompiler, diagnostics, Mermaid/Markdown importers.
 *
 * @packageDocumentation
 */

export { DSL_CODES, type DslCode, type DslCodeEntry } from './diagnostics/codes.js';
export { formatDiagnostics } from './diagnostics/format.js';
export { EDGE_OPS, type Edge, type EdgeEnd, type EdgeOp, type EdgeResult, edgeDiagnostic, parseEdge, parseEdgeObject } from './parse/edge.js';
export { editDistance, nearest, toSlug } from './resolve/suggest.js';
export type { CompileOptions, CompileResult, DslDiagnostic, SourceRange } from './types.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
