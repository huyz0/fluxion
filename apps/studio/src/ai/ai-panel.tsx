// The AI assistant panel (FR-EDT-014, ADR-0035): the person says what to change, picks the scope (document, screen or selection), sees the
// patch run on `store.fork()` as a change list and ghost boxes, and Apply runs `ai.applyPatch` on the real store as one undo step.
import type { Core, CoreRegistries } from '@fluxion/core';
import type { Session } from '@fluxion/editor';
import { t } from '@lingui/core/macro';
import { type JSX, useRef, useState } from 'react';
import { AiSettingsSection } from './ai-settings-section.js';
import { askForPatch } from './ask-patch.js';
import { type ClientSource, keyedClient } from './client.js';
import { type Preview, previewPatch } from './patch-preview.js';
import { type Scope, scopeText } from './scope.js';

/** Props of {@link AiPanel}. */
export type AiPanelProps = {
  readonly store: Core['store'];
  readonly execute: Core['execute'];
  readonly registries: CoreRegistries;
  readonly session: Session;
  /** The model to ask (default: the first provider with a key). */
  readonly source?: ClientSource;
};

type Proposal = { readonly patch: unknown; readonly preview: Preview };

const FILL = { added: '#16a34a55', changed: '#d9770655', kept: '#94a3b822' } as const;

/** The ghost overlay: the screen with the patch's boxes, new ones green, moved ones amber. */
function Ghost(props: { readonly preview: Extract<Preview, { ok: true }> }): JSX.Element {
  const { screen, boxes } = props.preview;
  return (
    <svg role="img" aria-label={t`Preview of the change`} viewBox={`0 0 ${screen.w} ${screen.h}`} style={{ width: '100%', border: '1px solid #cbd5e1' }}>
      {boxes.map((b) => (
        <rect
          key={b.id}
          data-state={b.state}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill={FILL[b.state]}
          stroke={b.state === 'kept' ? '#94a3b8' : '#0f172a'}
          strokeDasharray={b.state === 'added' ? '12 8' : undefined}
          strokeWidth={4}
        />
      ))}
    </svg>
  );
}

/** The assistant panel. */
export function AiPanel(props: AiPanelProps): JSX.Element {
  const { store, execute, registries, session, source = keyedClient } = props;
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<Scope>('screen');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [proposal, setProposal] = useState<Proposal | undefined>();
  const abort = useRef<AbortController | undefined>(undefined);

  const ask = async () => {
    setBusy(true);
    setSaid('');
    setProposal(undefined);
    const got = await source();
    if (!got.ok) {
      setSaid(got.problem);
      setBusy(false);
      return;
    }
    abort.current = new AbortController();
    const text = scopeText(store, scope, session.screen.get(), session.selection.get());
    const asked = await askForPatch({ client: got.client, prompt, scope: text, signal: abort.current.signal });
    setBusy(false);
    if (!asked.ok) return setSaid(asked.problem);
    const preview = previewPatch(store, registries, asked.patch, session.screen.get());
    if (preview.ok) setProposal({ patch: asked.patch, preview });
    else setSaid(preview.problems.join('; '));
  };

  const apply = () => {
    if (proposal === undefined) return;
    store.history.seal();
    const run = execute('ai.applyPatch', { patch: proposal.patch });
    store.history.seal();
    setSaid(run.ok ? t`Applied. Undo takes it back in one step.` : run.error.message);
    setProposal(undefined);
  };

  return (
    <aside aria-label={t`AI assistant`} className="fx-studio-ai" style={{ padding: 8, maxWidth: 360 }}>
      <AiSettingsSection />
      <label>
        {t`What should change?`}
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} style={{ display: 'block', width: '100%' }} />
      </label>
      <label>
        {t`Scope`}{' '}
        <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="document">{t`Document`}</option>
          <option value="screen">{t`Screen`}</option>
          <option value="selection">{t`Selection`}</option>
        </select>
      </label>
      <button type="button" disabled={busy || prompt.trim() === ''} onClick={() => void ask()}>
        {busy ? t`Asking…` : t`Ask`}
      </button>
      <p role="status" aria-live="polite">
        {said}
      </p>
      {proposal?.preview.ok ? (
        <section aria-label={t`Proposed change`}>
          <Ghost preview={proposal.preview} />
          <ul aria-label={t`Changes`}>
            {proposal.preview.changes.map((c) => (
              <li key={c.id} data-kind={c.kind}>
                {c.kind}: {c.label}
              </li>
            ))}
          </ul>
          <button type="button" onClick={apply}>
            {t`Apply`}
          </button>{' '}
          <button type="button" onClick={() => setProposal(undefined)}>
            {t`Discard`}
          </button>
        </section>
      ) : null}
    </aside>
  );
}
