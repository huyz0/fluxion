// The chrome around the canvas (FR-EDT-001, ADR-0029): the toolbar, the left tabs (screens, library,
// layers), the inspector and the timeline. The panels are placeholders their milestones fill (M7, M8).

import { useValue } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import { toolTitle } from './titles.js';
import './i18n.js';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { InspectorFields, type InspectorFieldsProps } from './inspector.js';
import { type EditorLayout, type PanelId, panelIds, panelShown, toggleFocus, togglePanelShown } from './layout.js';
import { LibraryPanel, type LibraryPanelProps } from './library/library-panel.js';
import { NotesPanel, type NotesPanelProps } from './notes-panel.js';
import { ProblemsTab, type ProblemsTabProps } from './problems-tab.js';
import { ScreensTab, type ScreensTabProps } from './screens-tab.js';
import type { Session } from './session.js';
import type { Tool, ToolDispatcher } from './tools.js';

/** Each panel's name: its landmark's label and its toolbar button's text. */
export const PANEL_NAMES: { readonly [P in PanelId]: string } = {
  // getters: the message is looked up when read, after the i18n instance is active
  get left() {
    return t`Screens, library and layers`;
  },
  get right() {
    return t`Inspector`;
  },
  get bottom() {
    return t`Timeline`;
  },
};

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
    <div className="fx-chrome-toolbar" role="banner" aria-label={t`Toolbar`}>
      {props.children}
      <span className="fx-chrome-spacer" />
      {panelIds().map((p) => (
        <button key={p} type="button" className="fx-chrome-button" aria-pressed={panelShown(layout, p)} onClick={() => onLayout(togglePanelShown(layout, p))}>
          {PANEL_NAMES[p]}
        </button>
      ))}
      <button type="button" className="fx-chrome-button" aria-pressed={layout.focus} onClick={() => onLayout(toggleFocus(layout))}>
        {t`Focus mode`}
      </button>
    </div>
  );
}

const TABS = [
  {
    name: 'Screens',
    get label() {
      return t`Screens`;
    },
    get text() {
      return t`The screens of this document will be listed here.`;
    },
  },
  {
    name: 'Library',
    get label() {
      return t`Library`;
    },
    get text() {
      return t`Shapes and components will be listed here.`;
    },
  },
  {
    name: 'Layers',
    get label() {
      return t`Layers`;
    },
    get text() {
      return t`The layers of this screen will be listed here.`;
    },
  },
  {
    name: 'Problems',
    get label() {
      return t`Problems`;
    },
    get text() {
      return t`The problems of this document will be listed here.`;
    },
  },
  {
    name: 'Notes',
    get label() {
      return t`Notes`;
    },
    get text() {
      return t`The speaker notes of this screen will be written here.`;
    },
  },
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
  /** The shape definitions the Library tab lists; without them it is a placeholder. */
  readonly library?: LibraryPanelProps | undefined;
};

/** The content of a left tab: its panel when the host gave it what it needs, else the placeholder text. */
function TabBody(props: LeftTabsProps & { readonly tab: (typeof TABS)[number] }): ReactNode {
  const { tab, screens, problems, notes, library } = props;
  if (tab.name === 'Screens' && screens !== undefined) return <ScreensTab {...screens} />;
  if (tab.name === 'Problems' && problems !== undefined) return <ProblemsTab {...problems} />;
  if (tab.name === 'Notes' && notes !== undefined) return <NotesPanel {...notes} />;
  if (tab.name === 'Library' && library !== undefined) return <LibraryPanel {...library} />;
  return <p className="fx-chrome-placeholder">{tab.text}</p>;
}

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
      <div role="tablist" aria-label={t`Left panel`} className="fx-chrome-tabs" onKeyDown={onKeyDown}>
        {TABS.map((tabItem, i) => (
          <button
            key={tabItem.name}
            id={`${id}-tab-${i}`}
            type="button"
            role="tab"
            className="fx-chrome-tab"
            aria-selected={i === selected}
            aria-controls={`${id}-panel`}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`}>
        <TabBody tab={tab} {...props} />
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
      <h2 className="fx-chrome-heading">{t`Inspector`}</h2>
      <p className="fx-chrome-placeholder" aria-live="polite">
        {count === 0 ? t`Select an element to see its properties.` : count === 1 ? t`${count} element selected` : t`${count} elements selected`}
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
    <fieldset className="fx-chrome-zoom" aria-label={t`Tools`}>
      {props.tools.list().map((tool: Tool) => (
        <button
          key={tool.id}
          type="button"
          className="fx-chrome-button"
          aria-pressed={current === tool.id}
          aria-keyshortcuts={tool.shortcut?.toUpperCase()}
          title={tool.shortcut === undefined ? toolTitle(tool) : `${toolTitle(tool)} (${tool.shortcut.toUpperCase()})`}
          onClick={() => session.tool.set(tool.id)}
        >
          {toolTitle(tool)}
        </button>
      ))}
    </fieldset>
  );
}

/** The timeline's placeholder. */
export function Timeline(): ReactNode {
  return (
    <>
      <h2 className="fx-chrome-heading">{t`Timeline`}</h2>
      <p className="fx-chrome-placeholder">{t`The animations of this screen will appear here.`}</p>
    </>
  );
}
