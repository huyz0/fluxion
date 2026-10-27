import type { Diagnostic } from '@fluxion/schema';
import type { SvgImportOptions, SvgImportResult } from './svg-import-types.js';

/** Shared conversion context; each icon is converted and witnessed through the single-SVG path. @public */
export type IconifyImportOptions = Omit<SvgImportOptions, 'id'> & {
  /** Namespace for qualified definition IDs; defaults to the collection prefix. */
  readonly namespace?: string;
};
/** Collection identity and declared metadata, retained verbatim; never license approval. @public */
export type IconifyProvenance = {
  /** Collection prefix from the source. */
  readonly prefix: string;
  /** SHA256 of the exact UTF8 source text. */
  readonly sourceSha256: string;
  /** Declared `info.name`, when a string. */
  readonly name?: string;
  /** Declared `info.author.name`, when a string. */
  readonly author?: string;
  /** Declared `info.license.spdx`, unverified; ADR-0050 decides distribution. */
  readonly license?: string;
};
/** One icon or alias; every source entry appears once, including refusals. @public */
export type IconifyIconOutcome = {
  /** Source icon or alias name. */
  readonly name: string;
  /** Qualified target ID, `namespace:name`. */
  readonly id: string;
  /** Direct parent, for an alias. */
  readonly parent?: string;
  /** Hidden in normal search; still registered so existing references resolve. */
  readonly hidden: boolean;
} & (
  | {
      /** Converted, with search keywords/category on the definition. */
      readonly status: 'accepted';
      /** Definition and retained obligations. */
      readonly value: SvgImportResult;
    }
  | {
      /** Missing parent, cycle, invalid properties or SVG refusal. */
      readonly status: 'refused';
      /** Nonempty failure diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
    }
);
/** Processed collection; may contain refusals and is never distribution approval. @public */
export type IconifyProcessedReport = {
  /** Every icon and alias has an outcome. */
  readonly status: 'processed';
  /** Source identity and declared metadata. */
  readonly provenance: IconifyProvenance;
  /** Entries in `icons`. */
  readonly iconCount: number;
  /** Entries in `aliases`. */
  readonly aliasCount: number;
  /** Successfully converted entries. */
  readonly acceptedCount: number;
  /** Icons then aliases, each in code-unit name order. */
  readonly entries: readonly IconifyIconOutcome[];
};
/** Collection report: a malformed or oversized collection fails before any conversion. @public */
export type IconifyImportReport =
  | {
      /** The collection itself is malformed or exceeds bounds; nothing was converted. */
      readonly status: 'failed';
      /** Collection-level diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | IconifyProcessedReport;
