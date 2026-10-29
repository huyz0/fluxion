// The host port of the library's SVG import (FR-LIB-004, M18.176): the editor's dialog declares the pack and its rights and maps
// colors; the host converts (it owns the paint witness, fonts and clock) and registers (it owns the registries and keeps every
// registered pack's source for the save, FR-LIB-009).
import type { ImportedPack, SvgMemberProblem } from '@fluxion/format';
import type { Diagnostic, Result, TokenRef } from '@fluxion/schema';
import type { SvgLibraryConversion, SvgLibraryOptions } from './import-svg.js';
import type { SvgLibraryInput } from './import-svg-input.js';

/** What the dialog asks the host to convert: the pack identity, the declared rights and the mapped colors. @public */
export type LibraryImportRequest = Pick<SvgLibraryOptions, 'namespace' | 'version' | 'name' | 'rights' | 'colors'>;

/** The host's SVG library import, behind the library panel's **Import SVG…**. @public */
export type LibraryImporter = {
  /** Converts the picked input under the request (`convertSvgLibrary` with the host's witness, fonts and clock); registers nothing. */
  readonly convert: (input: SvgLibraryInput, request: LibraryImportRequest) => Promise<Result<SvgLibraryConversion, readonly SvgMemberProblem[]>>;
  /** Registers the final pack (`registerSvgLibrary`), keeping its source for the save. */
  readonly register: (pack: ImportedPack) => Promise<Result<unknown, readonly Diagnostic[]>>;
  /** The theme's color token references a literal color may be mapped to. */
  readonly colorTokens: readonly TokenRef[];
};
