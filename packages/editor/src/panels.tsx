// The chrome around the canvas (FR-EDT-001, ADR-0029): the toolbar, the left tabs (screens, library,
// layers), the inspector and the timeline. The panels are placeholders their milestones fill (M7, M8).
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { type EditorLayout, type PanelId, panelIds, panelShown, toggleFocus, togglePanelShown } from './layout.js';

/** Each panel's name: its landmark's label and its toolbar button's text. */
export const PANEL_NAMES: { readonly [P in PanelId]: string } = { left: 'Screens, library and layers', right: 'Inspector', bottom: 'Timeline' };

/** Props of {@link Toolbar}. */
export type ToolbarProps = {
  /** The current layout. */
  readonly layout: EditorLayout;
  /** Called with each new layout. */
  readonly onLayout: (layout: EditorLayout) => void;
};

/** The top toolbar: a button per panel and focus mode, each pressed while on. */
export function Toolbar(props: ToolbarProps): ReactNode {
  const { layout, onLayout } = props;
  return (
    <header className="fx-chrome-toolbar">
      <span className="fx-chrome-spacer" />
      {panelIds().map((p) => (
        <button key={p} type="button" className="fx-chrome-button" aria-pressed={panelShown(layout, p)} onClick={() => onLayout(togglePanelShown(layout, p))}>
          {PANEL_NAMES[p]}
        </button>
      ))}
      <button type="button" className="fx-chrome-button" aria-pressed={layout.focus} onClick={() => onLayout(toggleFocus(layout))}>
        Focus mode
      </button>
    </header>
  );
}

const TABS = [
  { name: 'Screens', text: 'The screens of this document will be listed here.' },
  { name: 'Library', text: 'Shapes and components will be listed here.' },
  { name: 'Layers', text: 'The layers of this screen will be listed here.' },
] as const;

/** The next tab index after `key` from `i` (arrows wrap; Home and End), or undefined. */
function nextTab(key: string, i: number): number | undefined {
  const n = TABS.length;
  return new Map<string, number>([
    ['ArrowRight', (i + 1) % n],
    ['ArrowLeft', (i + n - 1) % n],
    ['Home', 0],
    ['End', n - 1],
  ]).get(key);
}

/** The left panel's tabs (the WAI-ARIA tabs pattern, activated on focus). */
export function LeftTabs(): ReactNode {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(e.key, selected);
    if (next === undefined) return;
    e.preventDefault();
    setSelected(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  const tab = TABS[selected] ?? TABS[0];
  return (
    <>
      <div role="tablist" aria-label="Left panel" className="fx-chrome-tabs" onKeyDown={onKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.name}
            id={`${id}-tab-${i}`}
            type="button"
            role="tab"
            className="fx-chrome-tab"
            aria-selected={i === selected}
            aria-controls={`${id}-panel`}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`}>
        <p className="fx-chrome-placeholder">{tab.text}</p>
      </div>
    </>
  );
}

/** The inspector's placeholder. */
export function Inspector(): ReactNode {
  return (
    <>
      <h2 className="fx-chrome-heading">Inspector</h2>
      <p className="fx-chrome-placeholder">Select an element to see its properties.</p>
    </>
  );
}

/** The timeline's placeholder. */
export function Timeline(): ReactNode {
  return (
    <>
      <h2 className="fx-chrome-heading">Timeline</h2>
      <p className="fx-chrome-placeholder">The animations of this screen will appear here.</p>
    </>
  );
}
