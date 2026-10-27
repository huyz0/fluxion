import type { Diagnostic } from '@fluxion/schema';
import type { SvgImportOptions, SvgImportResult } from './svg-import-types.js';

/** Shared conversion context; every entry is converted and witnessed through the single-SVG path. @public */
export type DrawioImportOptions = Omit<SvgImportOptions, 'id'> & {
  /** Namespace for qualified definition IDs. */
  readonly namespace: string;
};
/** One library entry; every entry appears once, in source order, including refusals. @public */
export type DrawioEntryOutcome = {
  /** Zero-based position in the library. */
  readonly index: number;
  /** Source title or stencil name, when present. */
  readonly title?: string;
  /** Qualified target ID derived from the title, unique within the library. */
  readonly id: string;
  /** Entry encoding: stencil shape, model fragment (plain or compressed) or embedded SVG image. */
  readonly kind: 'stencil' | 'model' | 'compressed-model' | 'svg' | 'unknown';
} & (
  | {
      /** Converted. */
      readonly status: 'accepted';
      /** Definition and retained obligations. */
      readonly value: SvgImportResult;
      /** Constructs drawn as placeholders or left out, such as external images; empty when complete. */
      readonly omissions: readonly string[];
    }
  | {
      /** Unsupported, malformed or refused by the SVG path. */
      readonly status: 'refused';
      /** Nonempty failure diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
    }
);
/** Processed library; refusals stay in the denominator. Never distribution approval. @public */
export type DrawioProcessedReport = {
  /** Every entry has an outcome. */
  readonly status: 'processed';
  /** `stencil` for a `<shapes>` library, `mxlibrary` for a JSON entry library. */
  readonly format: 'stencil' | 'mxlibrary';
  /** SHA256 of the exact UTF8 source text. */
  readonly sourceSha256: string;
  /** Entries in the library: the import-rate denominator. */
  readonly entryCount: number;
  /** Converted entries. */
  readonly acceptedCount: number;
  /** Outcomes in source order. */
  readonly entries: readonly DrawioEntryOutcome[];
};
/** Library report: malformed, empty or oversized libraries fail before conversion. @public */
export type DrawioImportReport =
  | {
      /** Nothing was converted. */
      readonly status: 'failed';
      /** Library-level diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | DrawioProcessedReport;
