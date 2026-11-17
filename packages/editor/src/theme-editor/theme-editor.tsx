// The theme editor (FR-THM-007, FR-THM-005, FR-THM-006, M20.11): the colour roles of the theme the open screen is drawn with, the
// palette generator, and previews of the shape variants. A lazy chunk: toolbar-extras.tsx loads it on the first open. Every edit is
// one `document.applyRecords`, so the canvas recolours in the same render; the inputs of one colour pick merge into one undo step.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { PALETTE_ROLES, type PaletteRole, type Theme, toCssVars } from '@fluxion/theme';
import { t } from '@lingui/core/macro';
import '../i18n.js';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Execute } from '../pointer.js';
import { colorOf, type EditedTheme, editedTheme, generated, themeWrite, variantPreviews, withColor } from './theme-edit.js';

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
};

/** The theme edited, following the records (an undo, a theme switch or a master change shows at once). */
function useEditedTheme(store: Store, screenId: RecordId | undefined): EditedTheme {
  const docId = (store.members('byType', 'document')[0] ?? '') as RecordId;
  const doc = useValue(useMemo(() => store.record$(docId), [store, docId]));
  const screen = useValue(useMemo(() => store.record$((screenId ?? '') as RecordId), [store, screenId])) as { masterId?: unknown } | undefined;
  const masterId = (typeof screen?.masterId === 'string' ? screen.masterId : '') as RecordId;
  const master = useValue(useMemo(() => store.record$(masterId), [store, masterId]));
  const holders = [screen, master, doc] as readonly ({ themeId?: unknown } | undefined)[];
  const themeId = (holders.map((h) => h?.themeId).find((id) => typeof id === 'string') ?? '') as RecordId;
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

/** The palette generator: up to three seeds, Generate and Shuffle, and what the contrast repair moved. */
function PaletteSection(props: { readonly primary: string; readonly onGenerate: (seeds: readonly string[], shuffle: number) => string }): ReactNode {
  const id = useId();
  const [seeds, setSeeds] = useState<readonly string[]>(() => [props.primary, '', '']);
  const [shuffle, setShuffle] = useState(0);
  const [status, setStatus] = useState('');
  const run = (next: number) => {
    setShuffle(next);
    setStatus(props.onGenerate(seeds, next));
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
  const { store, execute, screenId, onClose } = props;
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
