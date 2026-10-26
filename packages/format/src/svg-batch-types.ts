import type { Diagnostic } from '@fluxion/schema';
import type { SvgImportOptions, SvgImportResult } from './svg-import-types.js';

/** One named original input; a directory path ends in slash and has empty bytes. @public */
export type SvgBatchFile = {
  /** Relative source path, validated under the shared archive path policy. */
  readonly path: string;
  /** Original bytes, copied before any asynchronous effect. */
  readonly bytes: Uint8Array;
};
/** Named host files or a bounded archive; no filesystem extraction. @public */
export type SvgBatchInput =
  | {
      /** Named host selection. */
      readonly kind: 'files';
      /** All selected members. */
      readonly files: readonly SvgBatchFile[];
    }
  | {
      /** ZIP selection. */
      readonly kind: 'zip';
      /** Original bounded ZIP bytes. */
      readonly bytes: Uint8Array;
    };
/** Shared conversion context and exact source-to-ID mapping. @public */
export type SvgBatchOptions = Omit<SvgImportOptions, 'id'> & {
  /** Exactly one qualified ID for every SVG source, with no extra keys or duplicate IDs. */
  readonly ids: Readonly<Record<string, string>>;
};
/** One enumerated regular file, including unsupported or refused input. @public */
export type SvgBatchOutcome = {
  /** Original path, separate from nested diagnostic paths. */
  readonly path: string;
  /** SHA256 of original source bytes, even for refused inputs. */
  readonly sourceSha256: string;
} & (
  | {
      /** Successfully converted, not yet a distributable pack. */
      readonly status: 'accepted';
      /** Definition and retained obligations. */
      readonly value: SvgImportResult;
    }
  | {
      /** Failed conversion or unsupported regular member. */
      readonly status: 'refused';
      /** Nonempty failure diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
    }
);
/** Batch state; processed may contain refused entries and is never distribution approval. @public */
export type SvgBatchReport =
  | {
      /** Preflight refused all effects. */
      readonly status: 'preflight-failed';
      /** Whether all members could be enumerated. */
      readonly enumerationComplete: boolean;
      /** Global preflight diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
      /** Known regular members, including duplicate occurrences. */
      readonly inputs: readonly {
        /** Original source path. */
        readonly path: string;
        /** No conversion ran. */
        readonly status: 'not-attempted';
      }[];
    }
  | {
      /** Every regular member has an outcome. */
      readonly status: 'processed';
      /** All regular members, including unsupported files. */
      readonly inputCount: number;
      /** Members with case-insensitive SVG extension. */
      readonly svgCount: number;
      /** Successfully converted definitions only. */
      readonly acceptedCount: number;
      /** Stable code-unit path order. */
      readonly inputs: readonly SvgBatchOutcome[];
    };
