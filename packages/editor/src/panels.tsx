// The chrome around the canvas (FR-EDT-001, ADR-0029): the toolbar, the left tabs (screens, library,
// layers), the inspector and the timeline. The panels are placeholders their milestones fill (M7, M8).

import { useValue } from '@fluxion/render';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { InspectorFields, type InspectorFieldsProps } from './inspector.js';
import { type EditorLayout, type PanelId, panelIds, panelShown, toggleFocus, togglePanelShown } from './layout.js';
import { NotesPanel, type NotesPanelProps } from './notes-panel.js';
import { ProblemsTab, type ProblemsTabProps } from './problems-tab.js';
import { ScreensTab, type ScreensTabProps } from './screens-tab.js';
import type { Session } from './session.js';
import type { Tool, ToolDispatcher } from './tools.js';

/** Each panel's name: its landmark's label and its toolbar button's text. */
export const PANEL_NAMES: { readonly [P in PanelId]: string } = { left: 'Screens, library and layers', right: 'Inspector', bottom: 'Timeline' };

/** Props of {@link Toolbar}. */
export type ToolbarProps = {
  /** The current layout. */
  readonly layout: EditorLayout;
  /** Called with each new layout. */
  readonly onLayout: (layout: EditorLayout) => void;
  /** Controls at the toolbar's start (the zoom controls). */
  readonly children?: ReactNode;
};

/** The top toolbar: its controls, then a button per panel and focus mode, each pressed while on. */
export function Toolbar(props: ToolbarProps): ReactNode {
  const { layout, onLayout } = props;
  return (
    // a named banner landmark: biome takes a <header> as interactive once it has a role, so a div
    // biome-ignore lint/a11y/useSemanticElements: <header> with a label is refused by useAriaPropsSupportedByRole
    <div className="fx-chrome-toolbar" role="banner" aria-label="Toolbar">
      {props.children}
      <span className="fx-chrome-spacer" />
      {panelIds().map((p) => (
        <button key={p} type="button" className="fx-chrome-button" aria-pressed={panelShown(layout, p)} onClick={() => onLayout(togglePanelShown(layout, p))}>
          {PANEL_NAMES[p]}
        </button>
      ))}
      <button type="button" className="fx-chrome-button" aria-pressed={layout.focus} onClick={() => onLayout(toggleFocus(layout))}>
        Focus mode
      </button>
    </div>
  );
}

const TABS = [
  { name: 'Screens', text: 'The screens of this document will be listed here.' },
  { name: 'Library', text: 'Shapes and components will be listed here.' },
  { name: 'Layers', text: 'The layers of this screen will be listed here.' },
  { name: 'Problems', text: 'The problems of this document will be listed here.' },
  { name: 'Notes', text: 'The speaker notes of this screen will be written here.' },
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

/** Props of {@link LeftTabs}. */
export type LeftTabsProps = {
  /** The document and session the Screens tab lists and switches; without them it is a placeholder. */
  readonly screens?: ScreensTabProps | undefined;
  /** The document, session and command runner the Problems tab lists problems of; without them it is a placeholder. */
  readonly problems?: ProblemsTabProps | undefined;
  /** The document, command runner and shown screen the Notes tab edits the notes of; without them it is a placeholder. */
  readonly notes?: NotesPanelProps | undefined;
};

/** The left panel's tabs (the WAI-ARIA tabs pattern, activated on focus). */
export function LeftTabs(props: LeftTabsProps = {}): ReactNode {
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
        {tab.name === 'Screens' && props.screens !== undefined ? <ScreensTab {...props.screens} /> : null}
        {tab.name === 'Problems' && props.problems !== undefined ? <ProblemsTab {...props.problems} /> : null}
        {tab.name === 'Notes' && props.notes !== undefined ? <NotesPanel {...props.notes} /> : null}
        {(tab.name === 'Screens' && props.screens !== undefined) ||
        (tab.name === 'Problems' && props.problems !== undefined) ||
        (tab.name === 'Notes' && props.notes !== undefined) ? null : (
          <p className="fx-chrome-placeholder">{tab.text}</p>
        )}
      </div>
    </>
  );
}

/** Props of {@link Inspector}. */
export type InspectorProps = {
  /** The session whose selection it shows. */
  readonly session: Session;
  /** The document store and the command runner: with them the selection's properties are editable here. */
  readonly fields?: Omit<InspectorFieldsProps, 'session'> | undefined;
};

/** The inspector: how much is selected, and the properties the selection has in common. */
export function Inspector(props: InspectorProps): ReactNode {
  const count = useValue(props.session.selection.get).length;
  return (
    <>
      <h2 className="fx-chrome-heading">Inspector</h2>
      <p className="fx-chrome-placeholder" aria-live="polite">
        {count === 0 ? 'Select an element to see its properties.' : `${count} ${count === 1 ? 'element' : 'elements'} selected`}
      </p>
      {props.fields === undefined ? null : <InspectorFields {...props.fields} session={props.session} />}
    </>
  );
}

/** Props of {@link ToolButtons}. */
export type ToolButtonsProps = {
  /** The session whose tool they show and set. */
  readonly session: Session;
  /** The dispatcher, whose tools they list. */
  readonly tools: ToolDispatcher;
};

/** A pressed-state button per tool, titled with its shortcut. */
export function ToolButtons(props: ToolButtonsProps): ReactNode {
  const { session } = props;
  const current = useValue(session.tool.get);
  return (
    <fieldset className="fx-chrome-zoom" aria-label="Tools">
      {props.tools.list().map((tool: Tool) => (
        <button
          key={tool.id}
          type="button"
          className="fx-chrome-button"
          aria-pressed={current === tool.id}
          aria-keyshortcuts={tool.shortcut?.toUpperCase()}
          title={tool.shortcut === undefined ? tool.title : `${tool.title} (${tool.shortcut.toUpperCase()})`}
          onClick={() => session.tool.set(tool.id)}
        >
          {tool.title}
        </button>
      ))}
    </fieldset>
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
