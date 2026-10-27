// Canonical JSON for files written beside the document (the token file, the manifest): object keys sorted by code unit at every depth,
// 2-space indent, LF line ends, a trailing newline, `-0` as `0`, `undefined` fields dropped. The document itself is written by
// `serializeDocument` (@fluxion/schema), which also rounds geometry; this one rounds nothing. One definition, shared with the shape
// pack encoder (M18.108, ADR-0196).
export { canonicalJson } from '@fluxion/core';
