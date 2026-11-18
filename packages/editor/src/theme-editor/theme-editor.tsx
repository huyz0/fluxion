// The theme editor (FR-THM-007, FR-THM-005, FR-THM-006, M20.11): the colour roles of the theme the open screen is drawn with, the
// palette generator, and previews of the shape variants. A lazy chunk: toolbar-extras.tsx loads it on the first open. Every edit is
// one `document.applyRecords`, so the canvas recolours in the same render; the inputs of one colour pick merge into one undo step.
import { type Store, screenThemeChoice } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { PALETTE_ROLES, type PaletteRole, type Theme, toCssVars } from '@fluxion/theme';
import { t } from '@lingui/core/macro';
import '../i18n.js';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Execute } from '../pointer.js';
import { imageSeeds } from './image-seeds.js';
import { colorOf, type EditedTheme, editedTheme, generated, themeWrite, variantPreviews, withColor } from './theme-edit.js';
import { cssFile, downloadFile, importThemeFile, type ThemeFile, tokensFile } from './theme-files.js';

/**
 * Props of {@link ThemeEditor}.
 *
 * @public
 */
export type ThemeEditorProps = {
  /** The document store (the theme records are read from it and written to it). */
  readonly store: Store;
  /** Runs `document.applyRecords`. */
  readonly execute: Execute;
  /** The open screen: its theme is the one edited. */
  readonly screenId: RecordId | undefined;
  /** Close the editor. */
  readonly onClose: () => void;
  /** Hand the person an exported file (default: a browser download). */
  readonly download?: (file: ThemeFile) => void;
};

/** The theme edited, following the records (an undo, a theme switch or a master change shows at once). */
function useEditedTheme(store: Store, screenId: RecordId | undefined): EditedTheme {
  const docId = (store.members('byType', 'document')[0] ?? '') as RecordId;
  const doc = useValue(useMemo(() => store.record$(docId), [store, docId]));
  const screen = useValue(useMemo(() => store.record$((screenId ?? '') as RecordId), [store, screenId])) as { masterId?: unknown } | undefined;
  const masterId = (typeof screen?.masterId === 'string' ? screen.masterId : '') as RecordId;
  const master = useValue(useMemo(() => store.record$(masterId), [store, masterId]));
  // the theme record as the view picks it (core's one rule, M20.39): a master that does not apply names none
  // biome-ignore lint/correctness/useExhaustiveDependencies: the holder records are the inputs; core reads them again
  const themeId = useMemo(() => (screenThemeChoice(store, screenId).themeId ?? '') as RecordId, [store, screenId, doc, screen, master]);
  const record = useValue(useMemo(() => store.record$(themeId), [store, themeId]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the records read are the inputs; the store reads them again
  return useMemo(() => editedTheme(store, screenId), [store, screenId, doc, screen, master, record]);
}

/** Keys stay in the editor (the canvas's shortcuts do not act behind it); Esc closes it. */
function editorKey(e: KeyboardEvent<HTMLElement>, close: () => void): void {
  e.stopPropagation();
  if (e.key !== 'Escape') return;
  e.preventDefault();
  close();
}

/** One colour role: its colour input and its lock for the generator. */
function RoleRow(props: {
  readonly role: PaletteRole;
  readonly value: string;
  readonly locked: boolean;
  readonly onPick: (hex: string) => void;
  readonly onStart: () => void;
  readonly onEnd: () => void;
  readonly onLock: (locked: boolean) => void;
}): ReactNode {
  const { role, value, locked } = props;
  return (
    <li className="fx-chrome-theme-role">
      <span className="fx-chrome-theme-role-name">{role}</span>
      <input
        type="color"
        aria-label={t`${role} colour`}
        value={value}
        onFocus={props.onStart}
        onBlur={props.onEnd}
        onChange={(e) => props.onPick(e.target.value)}
      />
      <label className="fx-chrome-theme-lock">
        <input type="checkbox" aria-label={t`Lock ${role}`} checked={locked} onChange={(e) => props.onLock(e.target.checked)} />
        <span aria-hidden="true">{t`Lock`}</span>
      </label>
    </li>
  );
}

/** The palette generator: up to three seeds (typed, or drawn from an image), Generate and Shuffle, and what the contrast repair moved. */
function PaletteSection(props: { readonly primary: string; readonly onGenerate: (seeds: readonly string[], shuffle: number) => string }): ReactNode {
  const id = useId();
  const [seeds, setSeeds] = useState<readonly string[]>(() => [props.primary, '', '']);
  const [shuffle, setShuffle] = useState(0);
  const [status, setStatus] = useState('');
  // the latest generator: an image decodes after renders that may have changed the edited theme or the locks
  const generate = useRef(props.onGenerate);
  generate.current = props.onGenerate;
  const run = (next: number, from: readonly string[] = seeds) => {
    setShuffle(next);
    setStatus(generate.current(from, next));
  };
  const fromImage = async (file: File | undefined) => {
    if (file === undefined) return;
    setStatus(t`Reading the image…`);
    const out = await imageSeeds(file);
    if ('error' in out) return setStatus(out.error);
    const next = [0, 1, 2].map((i) => out.seeds[i] ?? '');
    setSeeds(next);
    run(shuffle, next);
  };
  return (
    <section className="fx-chrome-theme-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="fx-chrome-heading">{t`Palette`}</h3>
      {seeds.map((seed, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the three seed fields are fixed slots
        <label key={i} className="fx-chrome-formrow">
          {t`Seed colour ${i + 1}`}
          <input
            type="text"
            value={seed}
            placeholder={i === 0 ? t`for example #2563eb` : t`optional`}
            onChange={(e) => setSeeds(seeds.map((s, j) => (j === i ? e.target.value : s)))}
          />
        </label>
      ))}
      <label className="fx-chrome-formrow">
        {t`Seeds from an image`}
        <input type="file" accept="image/*" onChange={(e) => void fromImage(picked(e.target))} />
      </label>
      <div className="fx-chrome-theme-actions">
        <button type="button" className="fx-chrome-button" onClick={() => run(shuffle)}>
          {t`Generate palette`}
        </button>
        <button type="button" className="fx-chrome-button" onClick={() => run((shuffle + 1) % 2 ** 32)}>
          {t`Shuffle`}
        </button>
      </div>
      <p role="status" className="fx-chrome-hint">
        {status}
      </p>
    </section>
  );
}

/** The file a file input holds, its value cleared so that picking the same file again is a new pick. */
function picked(input: HTMLInputElement): File | undefined {
  const file = input.files?.[0];
  input.value = '';
  return file;
}

/** The theme as files: export it as a theme file or as CSS variables, and import a Fluxion or foreign DTCG file. */
function FilesSection(props: {
  readonly theme: Theme;
  readonly download: (file: ThemeFile) => void;
  readonly onImport: (text: string) => { readonly status: string; readonly warnings: readonly string[] };
}): ReactNode {
  const id = useId();
  const [status, setStatus] = useState('');
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const read = async (file: File | undefined) => {
    if (file === undefined) return;
    const out = props.onImport(await file.text());
    setStatus(out.status);
    setWarnings(out.warnings);
  };
  const exportTokens = () => {
    const { file, warnings: left } = tokensFile(props.theme);
    props.download(file);
    setStatus(left.length === 0 ? t`Exported ${file.name}.` : t`Exported ${file.name}; tokens left out are listed.`);
    setWarnings(left.map((w) => w.message));
  };
  return (
    <section className="fx-chrome-theme-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="fx-chrome-heading">{t`Theme files`}</h3>
      <div className="fx-chrome-theme-actions">
        <button type="button" className="fx-chrome-button" onClick={exportTokens}>
          {t`Export theme file`}
        </button>
        <button type="button" className="fx-chrome-button" onClick={() => props.download(cssFile(props.theme))}>
          {t`Export CSS`}
        </button>
      </div>
      <label className="fx-chrome-formrow">
        {t`Import theme file`}
        <input type="file" accept=".json,application/json" onChange={(e) => void read(picked(e.target))} />
      </label>
      <p role="status" className="fx-chrome-hint">
        {status}
      </p>
      {warnings.length === 0 ? null : (
        <ul className="fx-chrome-theme-warnings" aria-label={t`Theme file warnings`}>
          {warnings.map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list per import; two warnings may read the same
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The shape variants as the theme draws them. */
function VariantsSection(props: { readonly theme: Theme }): ReactNode {
  const id = useId();
  const vars = useMemo(() => toCssVars(props.theme) as CSSProperties, [props.theme]);
  return (
    <section className="fx-chrome-theme-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="fx-chrome-heading">{t`Variants`}</h3>
      <ul className="fx-chrome-variants" style={vars}>
        {variantPreviews(props.theme).map((v) => (
          <li key={v.name} className="fx-chrome-variant" data-variant={v.name}>
            <span
              className="fx-chrome-variant-swatch"
              aria-hidden="true"
              style={{ background: v.fill, borderColor: v.stroke, borderWidth: v.strokeWidth, borderStyle: 'solid' }}
            >
              <span className="fx-chrome-variant-text" style={{ background: v.text }} />
            </span>
            <span>{v.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The theme editor: a non-modal panel beside the canvas, which stays live under it.
 *
 * @public
 */
export function ThemeEditor(props: ThemeEditorProps): ReactNode {
  const { store, execute, screenId, onClose, download = downloadFile } = props;
  const edited = useEditedTheme(store, screenId);
  const [locked, setLocked] = useState<ReadonlySet<PaletteRole>>(new Set());
  const [error, setError] = useState('');
  // each colour pick (focus to blur) is one merge, so its many input events are one undo step
  const pick = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.querySelector<HTMLElement>('input')?.focus(), []);
  const write = (next: Theme, mergeKey?: string) => {
    const done = execute('document.applyRecords', themeWrite(store, edited, next), mergeKey === undefined ? undefined : { mergeKey });
    setError(done.ok ? '' : done.error.message);
  };
  const start = () => {
    store.history.seal();
    pick.current += 1;
  };
  const onGenerate = (seeds: readonly string[], shuffle: number): string => {
    const out = generated(edited.theme, { seeds, locked, shuffle });
    if ('error' in out) return out.error;
    store.history.seal();
    write(out.theme);
    return out.palette.adjusted.length === 0 ? t`Palette applied.` : t`Palette applied; adjusted for contrast: ${out.palette.adjusted.join(', ')}.`;
  };
  const onImport = (text: string) => {
    const read = importThemeFile(store, edited, text);
    if ('error' in read) return { status: read.error, warnings: [] };
    store.history.seal();
    const done = execute('document.applyRecords', read.write);
    if (!done.ok) return { status: done.error.message, warnings: [] };
    return { status: t`Imported ${read.theme.name}.`, warnings: read.warnings.map((w) => w.message) };
  };
  return (
    <div
      ref={root}
      className="fx-chrome-picker fx-chrome-theme-editor"
      role="dialog"
      aria-modal="false"
      aria-label={t`Theme editor`}
      onKeyDown={(e) => editorKey(e, onClose)}
    >
      <h2 className="fx-chrome-heading">{t`Theme editor`}</h2>
      <p className="fx-chrome-hint">{t`Editing ${edited.theme.name}`}</p>
      <section className="fx-chrome-theme-section" aria-label={t`Colours`}>
        <h3 className="fx-chrome-heading">{t`Colours`}</h3>
        <ul className="fx-chrome-theme-roles">
          {PALETTE_ROLES.map((role) => (
            <RoleRow
              key={role}
              role={role}
              value={colorOf(edited.theme, role)}
              locked={locked.has(role)}
              onStart={start}
              onEnd={() => store.history.seal()}
              onPick={(hex) => write(withColor(edited.theme, role, hex), `theme-editor:${role}:${pick.current}`)}
              onLock={(on) => setLocked((s) => (on ? new Set([...s, role]) : new Set([...s].filter((r) => r !== role))))}
            />
          ))}
        </ul>
      </section>
      <PaletteSection primary={colorOf(edited.theme, 'primary')} onGenerate={onGenerate} />
      <VariantsSection theme={edited.theme} />
      <FilesSection theme={edited.theme} download={download} onImport={onImport} />
      {error === '' ? null : (
        <p role="alert" className="fx-chrome-hint">
          {error}
        </p>
      )}
      <button type="button" className="fx-chrome-button" onClick={onClose}>
        {t`Close`}
      </button>
    </div>
  );
}
