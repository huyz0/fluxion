import type { OpenedFile } from './file-session.js';

/** Original file data carried atomically with journal metadata, separate from edited records. */
export type FileRecoveryState = Pick<
  OpenedFile,
  'source' | 'extraEntries' | 'manifestExtras' | 'plugins' | 'shapePacks' | 'unresolvedShapeIds' | 'artworkFonts'
>;

/** Capture owned recovery data without granting provenance to references introduced by later edits. */
export function fileRecoveryState(file: OpenedFile): FileRecoveryState {
  return structuredClone({
    ...(file.source === undefined ? {} : { source: file.source }),
    extraEntries: file.extraEntries,
    manifestExtras: file.manifestExtras,
    plugins: file.plugins ?? [],
    shapePacks: file.shapePacks ?? [],
    unresolvedShapeIds: file.unresolvedShapeIds ?? new Set<string>(),
    // the bytes the saved 1.1 packs bind: they have no asset record, so the journal's assets would not bring them back
    artworkFonts: file.artworkFonts ?? new Map<string, Uint8Array>(),
  });
}
