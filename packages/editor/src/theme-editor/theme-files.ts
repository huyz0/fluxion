// The theme editor's files (FR-THM-007, FR-THM-009, M20.38): the edited theme as a Fluxion theme file (`<slug>.tokens.json`,
// exportDtcg) and as CSS variables (themeToCss), and a Fluxion or foreign DTCG file read in as a new theme record that the
// edited screen's choice then names, in one `document.applyRecords`.
import type { Store } from '@fluxion/core';
import { type DtcgWarning, exportDtcg, importDtcg, type Theme, themeFileName, themeToCss } from '@fluxion/theme';
import { t } from '@lingui/core/macro';
import { type EditedTheme, themeWrite } from './theme-edit.js';
import '../i18n.js';

/** A file to hand the person: its name, its text and its media type. */
export type ThemeFile = { readonly name: string; readonly text: string; readonly type: string };

/** `theme` as a Fluxion DTCG theme file, `<slug>.tokens.json`, and exportDtcg's warnings (the tokens it left out). */
export function tokensFile(theme: Theme): { readonly file: ThemeFile; readonly warnings: readonly DtcgWarning[] } {
  const { file, warnings } = exportDtcg(theme);
  return { file: { name: themeFileName(theme), text: `${JSON.stringify(file, null, 2)}\n`, type: 'application/json' }, warnings };
}

/** `theme`'s CSS variables on `:root`, `<slug>.css`. */
export function cssFile(theme: Theme): ThemeFile {
  return { name: themeFileName(theme).replace(/\.tokens\.json$/, '.css'), text: themeToCss(theme), type: 'text/css' };
}

/** What reading a theme file gives: the write that adds it, its theme and importDtcg's warnings; or why it could not be read. */
export type ThemeImport =
  | {
      readonly write: ReturnType<typeof themeWrite>;
      readonly theme: Theme;
      readonly warnings: readonly DtcgWarning[];
    }
  | { readonly error: string };

/**
 * The text of a theme file read as a theme (importDtcg: a Fluxion file as written, a foreign one mapped onto the light theme
 * with its warnings), added under a free `theme-<name>` id with the record that chose the edited theme pointed at it. The edited
 * theme's record is never overwritten.
 */
export function importThemeFile(store: Store, edited: EditedTheme, text: string): ThemeImport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: t`the file is not JSON` };
  }
  const read = importDtcg(json);
  if (!read.ok) return { error: read.error.message };
  const { theme, warnings } = read.value;
  return { write: themeWrite(store, { ...edited, recordId: undefined }, theme), theme, warnings };
}

/** Hand the browser `file` to save. */
export function downloadFile(file: ThemeFile): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([file.text], { type: file.type }));
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
