// The layout picker (FR-LAY-003, FR-LAY-010, M17.18): in the inspector, a choice of the registered layouts for the selected group or frame, the shown
// screen, or two or more selected elements, and for a group or frame with a layout a "Make live" toggle (layout-picker.ts).
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo } from 'react';
import type { ArrangePort } from './layout-arrange.js';
import { canBeLive, chosenChoice, type PickTarget, pickLayout, pickTarget, pickTemplate, screenItems, setLive, TEMPLATE_CHOICE } from './layout-picker.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

/**
 * Props of {@link LayoutPickerSection}.
 *
 * @public
 */
export type LayoutPickerSectionProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection picks the target. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
  /** The screen shown. */
  readonly screenId: string | undefined;
  /** The registered layouts offered, by name. */
  readonly choices: readonly string[];
  /** The registered templates offered for the screen, by id; built from the screen's shapes' labels. */
  readonly templates?: readonly string[] | undefined;
  /** Lays out in the host's layout worker (the studio's); without it the arrange runs on the page's thread. */
  readonly arrange?: ArrangePort | undefined;
};

/** The words above the choice: what a pick will lay out. */
function titleOf(target: PickTarget): string {
  if (target.kind === 'selection') return t`Arrange the selection`; // kind-switch-allow: a pick target is a container, the screen or a selection
  return target.kind === 'screen' ? t`Screen layout` : t`Layout`; // kind-switch-allow: a pick target is a container, the screen or a selection
}

/**
 * The layout picker of the selected group or frame, the shown screen (nothing selected) or the selected elements (two or more); nothing for one
 * selected shape or without layouts to offer.
 *
 * @public
 */
export function LayoutPickerSection(props: LayoutPickerSectionProps): ReactNode {
  const { store, session, execute, screenId, choices, arrange } = props;
  const templates = props.templates ?? [];
  const selection = useValue(session.selection.get);
  const target = useValue(useMemo(() => store.query((view) => pickTarget((id) => view.get(id as never), selection, screenId)), [store, selection, screenId]));
  if (target === undefined || screenId === undefined || choices.length === 0) return null;
  // a layout that is not one of the choices shows the placeholder, not the first choice
  const current = chosenChoice(target);
  const offered = target.kind === 'screen' ? templates : []; // kind-switch-allow: a template is built into a screen only
  const chosen = choices.includes(current) || offered.some((id) => `${TEMPLATE_CHOICE}${id}` === current) ? current : '';
  const apply = (choice: string): void => {
    if (choice === '') return;
    const done = choice.startsWith(TEMPLATE_CHOICE)
      ? pickTemplate(execute, target, {
          templateId: choice.slice(TEMPLATE_CHOICE.length),
          items: screenItems((id) => store.get(id as never), store.members('byScreen', screenId)),
        })
      : pickLayout(execute, target, { screenId, algorithm: choice }, arrange);
    if (done) store.history.seal();
  };
  return (
    <fieldset className="fx-chrome-group" aria-label={t`Layout picker`}>
      <legend className="fx-chrome-heading">{titleOf(target)}</legend>
      <label className="fx-chrome-field">
        <span className="fx-chrome-field-label">{t`Layout`}</span>
        <select className="fx-chrome-input" aria-label={t`Layout algorithm`} value={chosen} onChange={(e) => apply(e.currentTarget.value)}>
          <option value="" disabled>
            —
          </option>
          {choices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {offered.length === 0 ? null : (
            <optgroup label={t`Templates (from the shapes' labels)`}>
              {offered.map((id) => (
                <option key={id} value={`${TEMPLATE_CHOICE}${id}`}>
                  {id}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {canBeLive(target) ? (
        <label className="fx-chrome-field">
          <span className="fx-chrome-field-label">{t`Make live`}</span>
          <input
            type="checkbox"
            aria-label={t`Make live`}
            checked={target.kind === 'container' && target.spec?.['live'] === true} // kind-switch-allow: only a container is live
            onChange={(e) => {
              if (setLive(execute, target, e.currentTarget.checked)) store.history.seal();
            }}
          />
        </label>
      ) : null}
    </fieldset>
  );
}
