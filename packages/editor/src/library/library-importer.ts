// The host port of the library's SVG, Iconify and draw.io import (FR-LIB-004/005/006, M18.176, M18.210): the editor's dialog
// declares the pack and its rights and maps colors; the host converts (it owns the paint witness, fonts and clock) and registers (it
// owns the registries and keeps every registered pack's source for the save, FR-LIB-009).
import type { ImportedPack, SvgMemberProblem } from '@fluxion/format';
import type { Diagnostic, Result, TokenRef } from '@fluxion/schema';
import type { CollectionLibraryConversion, CollectionLibraryInput, CollectionLibraryOptions } from './import-collection.js';
import type { SvgLibraryConversion, SvgLibraryOptions } from './import-svg.js';
import type { SvgLibraryInput } from './import-svg-input.js';

/** What the dialog asks the host to convert: the pack identity, the declared rights and the mapped colors. @public */
export type LibraryImportRequest = Pick<SvgLibraryOptions, 'namespace' | 'version' | 'name' | 'rights' | 'colors'>;

/** What the library panel picked: SVG files or a ZIP, or one Iconify collection or draw.io library. @public */
export type LibraryImportInput = SvgLibraryInput | CollectionLibraryInput;

/** The host's library import, behind the library panel's **Import SVG…** (and **Import Iconify…**, **Import draw.io…**). @public */
export type LibraryImporter = {
  /** Converts the picked input under the request (`convertSvgLibrary` with the host's witness, fonts and clock); registers nothing. */
  readonly convert: (input: SvgLibraryInput, request: LibraryImportRequest) => Promise<Result<SvgLibraryConversion, readonly SvgMemberProblem[]>>;
  /**
   * Converts one Iconify collection (no declaration: its own licence credits it) or draw.io library (the declared identity and one
   * credit) with `convertCollectionLibrary`; registers nothing. Without it the panel offers only **Import SVG…**.
   */
  readonly convertCollection?: (
    input: CollectionLibraryInput,
    declared: CollectionLibraryOptions['declared'],
  ) => Promise<Result<CollectionLibraryConversion, readonly SvgMemberProblem[]>>;
  /** Registers the final pack (`registerSvgLibrary`), keeping its source for the save. */
  readonly register: (pack: ImportedPack) => Promise<Result<unknown, readonly Diagnostic[]>>;
  /** The theme's color token references a literal color may be mapped to. */
  readonly colorTokens: readonly TokenRef[];
};
