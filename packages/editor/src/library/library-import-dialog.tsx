// The library's Import SVG dialog (FR-LIB-004, NFR-LIC-003, M18.176): the person declares the pack and its rights, converts once,
// sees each refusal by member path or the accepted count and the colors found, maps any color to a theme token, and imports. A
// mapped color re-converts first, so the witness sees the mapped paint; only the final pack is registered, never the first.
import { shapePackContentLicenses } from '@fluxion/core';
import type { TokenRef } from '@fluxion/schema';
import { plural, t } from '@lingui/core/macro';
import '../i18n.js';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { dialogKey } from '../dialog-keys.js';
import type { SvgLibraryConversion } from './import-svg.js';
import type { SvgLibraryInput } from './import-svg-input.js';
import { initialForm, type LibraryImportForm, type RightsKind, requestOf } from './library-import-form.js';
import type { LibraryImporter } from './library-importer.js';

/** Props of {@link LibraryImportDialog}. @public */
export type LibraryImportDialogProps = {
  /** The host's importer. */
  readonly importer: LibraryImporter;
  /** What the person picked. */
  readonly input: SvgLibraryInput;
  /** Close the dialog. */
  readonly onClose: () => void;
};

type Phase =
  | { readonly step: 'idle' }
  | { readonly step: 'converting' }
  | { readonly step: 'refused'; readonly problems: readonly { readonly path: string; readonly message: string }[] }
  | { readonly step: 'converted'; readonly conversion: SvgLibraryConversion }
  | { readonly step: 'importing' }
  | { readonly step: 'imported'; readonly count: number };

/** One labelled text field of the form. */
function Field(props: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }): ReactNode {
  return (
    <label className="fx-chrome-formrow">
      {props.label}
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

/** The rights fields of the chosen form. */
function Rights(props: { readonly form: LibraryImportForm; readonly set: (patch: Partial<LibraryImportForm>) => void }): ReactNode {
  const { form, set } = props;
  // which pick a finished read belongs to: only the latest file's text is taken, however the reads finish
  const picks = useRef(0);
  if (form.kind === 'credits')
    return (
      <>
        <label className="fx-chrome-formrow">
          {t`Credits file (JSON, notices inline)`}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const pick = ++picks.current;
              // the earlier file's credits go at once, so a convert before this one is read is refused, never run under them
              set({ creditsText: undefined, creditsName: undefined });
              void file?.text().then((creditsText) => (pick === picks.current ? set({ creditsText, creditsName: file.name }) : undefined));
            }}
          />
        </label>
        {form.creditsName === undefined ? null : <output>{t`Read ${form.creditsName}`}</output>}
      </>
    );
  return (
    <>
      <label className="fx-chrome-formrow">
        {t`License`}
        <select value={form.license} onChange={(e) => set({ license: e.target.value })}>
          <option value="">{t`Choose a license`}</option>
          {shapePackContentLicenses.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <Field label={t`Attribution`} value={form.attribution} onChange={(attribution) => set({ attribution })} />
      {form.kind === 'original' ? (
        <Field label={t`Author`} value={form.author} onChange={(author) => set({ author })} />
      ) : (
        <>
          <Field label={t`Source`} value={form.reference} onChange={(reference) => set({ reference })} />
          <Field label={t`Source SHA-256`} value={form.sha256} onChange={(sha256) => set({ sha256 })} />
        </>
      )}
    </>
  );
}

/** The colors found, each with its token select (keep, or a theme token), and how many more were not offered. */
function Colors(props: {
  readonly conversion: SvgLibraryConversion;
  readonly tokens: readonly TokenRef[];
  readonly mapped: Readonly<Record<string, TokenRef>>;
  readonly onMap: (color: string, token: TokenRef | undefined) => void;
}): ReactNode {
  const { conversion, tokens, mapped, onMap } = props;
  if (conversion.colors.length === 0) return null;
  return (
    <fieldset className="fx-chrome-formrow">
      <legend>{t`Colors`}</legend>
      {conversion.colors.map((color) => (
        <label key={color} className="fx-chrome-customrow" data-color={color}>
          <span className="fx-chrome-swatch" style={{ background: color }} aria-hidden="true" />
          {color}
          <select
            aria-label={t`Token for ${color}`}
            value={mapped[color] ?? ''}
            onChange={(e) => onMap(color, (e.target.value || undefined) as TokenRef | undefined)}
          >
            <option value="">{t`Keep as written`}</option>
            {tokens.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </select>
        </label>
      ))}
      {conversion.colorsOmitted > 0 ? (
        <p>{plural(conversion.colorsOmitted, { one: '# more color is not offered', other: '# more colors are not offered' })}</p>
      ) : null}
    </fieldset>
  );
}

/** What the dialog shows below the form for `phase`. */
function Outcome(props: { readonly phase: Phase; readonly colors: ReactNode }): ReactNode {
  const { phase } = props;
  if (phase.step === 'converting') return <p aria-live="polite">{t`Converting…`}</p>;
  if (phase.step === 'importing') return <p aria-live="polite">{t`Importing…`}</p>;
  if (phase.step === 'imported') return <p aria-live="polite">{plural(phase.count, { one: 'Imported # shape', other: 'Imported # shapes' })}</p>;
  if (phase.step === 'refused')
    return (
      <ul role="alert" className="fx-chrome-import-refusals">
        {phase.problems.map((p) => (
          <li key={`${p.path}\u0000${p.message}`} data-path={p.path}>
            {p.path === '' ? p.message : `${p.path}: ${p.message}`}
          </li>
        ))}
      </ul>
    );
  if (phase.step !== 'converted') return null;
  return (
    <>
      <p aria-live="polite">{plural(phase.conversion.pack.source.definitions.length, { one: '# shape is ready', other: '# shapes are ready' })}</p>
      {props.colors}
    </>
  );
}

/** What the dialog's steps act on. */
type Steps = {
  readonly importer: LibraryImporter;
  readonly input: SvgLibraryInput;
  readonly form: LibraryImportForm;
  readonly mapped: Readonly<Record<string, TokenRef>>;
  readonly setPhase: (phase: Phase) => void;
};

const declarationRefused = (problems: readonly string[]): Phase => ({ step: 'refused', problems: problems.map((message) => ({ path: '', message })) });

/** Convert once under the declaration; an incomplete declaration is refused before anything is converted. */
async function convertStep({ importer, input, form, setPhase }: Steps): Promise<void> {
  const request = requestOf(form);
  if (Array.isArray(request)) return setPhase(declarationRefused(request));
  setPhase({ step: 'converting' });
  const done = await importer.convert(input, request);
  setPhase(done.ok ? { step: 'converted', conversion: done.value } : { step: 'refused', problems: done.error });
}

/** Register the final pack: re-converted first when a color is mapped, so the witness sees the mapped paint. */
async function importStep({ importer, input, form, mapped, setPhase }: Steps, conversion: SvgLibraryConversion): Promise<void> {
  setPhase({ step: 'importing' });
  let final = conversion;
  if (Object.keys(mapped).length) {
    // the first pack is discarded, never registered
    const request = requestOf(form);
    if (Array.isArray(request)) return setPhase(declarationRefused(request));
    const again = await importer.convert(input, { ...request, colors: mapped });
    if (!again.ok) return setPhase({ step: 'refused', problems: again.error });
    final = again.value;
  }
  const registered = await importer.register(final.pack);
  setPhase(
    registered.ok
      ? { step: 'imported', count: final.pack.source.definitions.length }
      : { step: 'refused', problems: registered.error.map((d) => ({ path: '', message: d.message })) },
  );
}

/**
 * The dialog that imports picked SVG files or a ZIP into the library.
 *
 * @public
 */
export function LibraryImportDialog(props: LibraryImportDialogProps): ReactNode {
  const { importer, input, onClose } = props;
  const dialog = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<LibraryImportForm>(() => initialForm(input));
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [mapped, setMapped] = useState<Readonly<Record<string, TokenRef>>>({});
  useEffect(() => {
    dialog.current?.querySelector('input')?.focus();
  }, []);
  const set = (patch: Partial<LibraryImportForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    // any change to the declaration discards the conversion, so the pack registered is always the one declared
    setPhase({ step: 'idle' });
    setMapped({});
  };
  const ctx: Steps = { importer, input, form, mapped, setPhase };
  const busy = phase.step === 'converting' || phase.step === 'importing';
  const colors =
    phase.step === 'converted' ? (
      <Colors
        conversion={phase.conversion}
        tokens={importer.colorTokens}
        mapped={mapped}
        onMap={(color, token) =>
          setMapped((m) => {
            const { [color]: _, ...rest } = m;
            return token === undefined ? rest : { ...rest, [color]: token };
          })
        }
      />
    ) : null;
  return (
    <div
      ref={dialog}
      className="fx-chrome-picker fx-chrome-import"
      role="dialog"
      aria-modal="true"
      aria-label={t`Import SVG`}
      // Esc closes only when nothing runs: what a running convert or import ends with is always shown
      onKeyDown={(e) => dialogKey(e, busy ? () => undefined : onClose)}
    >
      <h2 className="fx-chrome-heading">{t`Import SVG`}</h2>
      <p>{plural(input.items.length, { one: '# file picked', other: '# files picked' })}</p>
      {/* the declaration is fixed while a convert or import runs, so what finishes is always what the dialog shows */}
      <fieldset className="fx-chrome-import-declaration" disabled={busy}>
        <Field label={t`Namespace`} value={form.namespace} onChange={(namespace) => set({ namespace })} />
        <Field label={t`Version`} value={form.version} onChange={(version) => set({ version })} />
        <Field label={t`Name`} value={form.name} onChange={(name) => set({ name })} />
        <label className="fx-chrome-formrow">
          {t`Rights`}
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value as RightsKind })}>
            <option value="original">{t`My own work`}</option>
            <option value="upstream">{t`From a source`}</option>
            <option value="credits">{t`Credits file…`}</option>
          </select>
        </label>
        <Rights form={form} set={set} />
      </fieldset>
      <Outcome phase={phase} colors={colors} />
      <div className="fx-chrome-actions">
        <button type="button" className="fx-chrome-button" disabled={busy || phase.step === 'imported'} onClick={() => void convertStep(ctx)}>
          {t`Convert`}
        </button>
        <button
          type="button"
          className="fx-chrome-button"
          disabled={phase.step !== 'converted'}
          onClick={() => (phase.step === 'converted' ? void importStep(ctx, phase.conversion) : undefined)}
        >
          {t`Import`}
        </button>
        <button type="button" className="fx-chrome-button" disabled={busy} onClick={onClose}>
          {phase.step === 'imported' ? t`Done` : t`Cancel`}
        </button>
      </div>
    </div>
  );
}
