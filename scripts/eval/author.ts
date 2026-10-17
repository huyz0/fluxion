// The scripted cases (ADR-0039): 30 cases and their replies written by hand-made templates, not by a model. They exercise the whole recorded
// pipeline (outline, compile, repair, patch, lint, scorecard) so a regression in any of it shows as a number. They say nothing about how good a
// model is: only `--live` (M15.19) measures that, and its recordings replace these (`source: 'live'`).
import type { EvalCase, RecordedRequest, Recording } from '@fluxion/dsl';

export type Authored = { readonly case: EvalCase; readonly recording: Recording };

const TOPICS: readonly { slug: string; title: string; steps: readonly string[] }[] = [
  { slug: 'checkout', title: 'Checkout', steps: ['Cart', 'Address', 'Payment', 'Confirmation'] },
  { slug: 'onboarding', title: 'Staff onboarding', steps: ['Offer signed', 'Laptop ordered', 'Accounts created', 'First day'] },
  { slug: 'incident', title: 'Incident response', steps: ['Alert fires', 'Triage', 'Mitigate', 'Postmortem'] },
  { slug: 'release', title: 'Release train', steps: ['Branch cut', 'Stabilise', 'Ship', 'Announce'] },
  { slug: 'support', title: 'Support desk', steps: ['Ticket opened', 'Categorise', 'Resolve', 'Survey'] },
  { slug: 'etl', title: 'Data pipeline', steps: ['Extract', 'Clean', 'Load', 'Report'] },
  { slug: 'auth', title: 'Sign in flow', steps: ['Enter email', 'Send code', 'Verify code', 'Session starts'] },
  { slug: 'hiring', title: 'Hiring loop', steps: ['Application', 'Phone screen', 'On-site', 'Offer'] },
  { slug: 'billing', title: 'Billing run', steps: ['Usage metered', 'Invoice built', 'Payment taken', 'Receipt sent'] },
  { slug: 'deploy', title: 'Deploy pipeline', steps: ['Commit', 'Build', 'Test', 'Roll out'] },
  { slug: 'research', title: 'Research method', steps: ['Question', 'Experiment', 'Analysis', 'Paper'] },
  { slug: 'orders', title: 'Order fulfilment', steps: ['Order placed', 'Picked', 'Packed', 'Delivered'] },
  { slug: 'review', title: 'Code review', steps: ['Pull request', 'Review', 'Revise', 'Merge'] },
  { slug: 'budget', title: 'Budget cycle', steps: ['Forecast', 'Allocate', 'Spend', 'Audit'] },
  { slug: 'launch', title: 'Product launch', steps: ['Brief', 'Build', 'Beta', 'Launch'] },
  { slug: 'backup', title: 'Backup plan', steps: ['Snapshot', 'Encrypt', 'Copy offsite', 'Restore test'] },
  { slug: 'travel', title: 'Travel approval', steps: ['Request', 'Manager', 'Finance', 'Booked'] },
  { slug: 'procurement', title: 'Procurement', steps: ['Need raised', 'Quotes', 'Approval', 'Purchase order'] },
  { slug: 'training', title: 'Training plan', steps: ['Assess', 'Teach', 'Practise', 'Certify'] },
  { slug: 'moderation', title: 'Content moderation', steps: ['Report', 'Queue', 'Decision', 'Appeal'] },
];

const SHAPES = ['ellipse', 'rounded-rect', 'rounded-rect', 'ellipse'];
const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function screenText(id: string, title: string, steps: readonly string[], shape = (i: number) => SHAPES[i % SHAPES.length]): string {
  const nodes = steps.map((s, i) => `    ${slugOf(s)}: { shape: ${shape(i)}, label: ${s}${i === 0 ? ', tone: accent' : ''}, alt: ${s} step }`);
  const edges = steps.slice(1).map((s, i) => `    - ${slugOf(steps[i] ?? '')} -> ${slugOf(s)}`);
  return `- id: ${id}\n  title: ${title}\n  nodes:\n${nodes.join('\n')}\n  edges:\n${edges.join('\n')}\n`;
}

const request = (text: string): RecordedRequest => {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += 48) chunks.push(text.slice(at, at + 48));
  return { chunks, tokensIn: 400, tokensOut: Math.ceil(text.length / 4) };
};
const scripted = (requests: readonly RecordedRequest[]): Recording => ({ version: 1, source: 'scripted', model: 'scripted-v1', requests });

function generateCase(t: (typeof TOPICS)[number], needsRepair: boolean): Authored {
  const overview = `${t.slug}-overview`;
  const detail = `${t.slug}-detail`;
  const outline = JSON.stringify({
    title: t.title,
    screens: [
      { id: overview, title: `${t.title} at a glance`, intent: 'the steps in order' },
      { id: detail, title: `${t.title} in two halves`, intent: 'the first and the last two steps' },
    ],
  });
  const first = screenText(overview, `${t.title} at a glance`, t.steps);
  const requests = [request(outline)];
  if (needsRepair) requests.push(request(first.replace('shape: ellipse', 'shape: rectangle')));
  requests.push(request(first), request(screenText(detail, `${t.title} in two halves`, [t.steps[0] ?? 'Start', t.steps[3] ?? 'End'])));
  const c: EvalCase = {
    id: `gen-${t.slug}`,
    mode: 'generate',
    prompt: `A two-screen deck about ${t.title.toLowerCase()}: the steps, then the first and last.`,
    expect: { screens: [2, 2], kinds: ['shape', 'connector'], mustContain: [t.steps[0] ?? ''], minLint: 80 },
  };
  return { case: c, recording: scripted(requests) };
}

const BASE = `flux: 1\ntitle: Service\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      api: { shape: rounded-rect, label: API }\n      db: { shape: rounded-rect, label: Database }\n    edges:\n      - api -> db\n`;

const EDITS: readonly { id: string; prompt: string; patch: object; contain: string }[] = [
  {
    id: 'edit-add-cache',
    prompt: 'Add a cache node.',
    patch: { flux: 1, ops: [{ op: 'add', screen: 'main', slug: 'cache', node: { shape: 'rounded-rect', label: 'Cache' } }] },
    contain: 'Cache',
  },
  {
    id: 'edit-rename-db',
    prompt: 'Call the database "Primary store".',
    patch: { flux: 1, ops: [{ op: 'update', target: 'db', set: { label: 'Primary store' } }] },
    contain: 'Primary store',
  },
  {
    id: 'edit-add-and-connect',
    prompt: 'Add a queue after the API.',
    patch: {
      flux: 1,
      ops: [
        { op: 'add', screen: 'main', slug: 'queue', node: { shape: 'rounded-rect', label: 'Queue' } },
        { op: 'connect', edge: 'api -> queue: jobs' },
      ],
    },
    contain: 'Queue',
  },
  { id: 'edit-remove-db', prompt: 'Remove the database.', patch: { flux: 1, ops: [{ op: 'remove', target: 'db', cascade: true }] }, contain: 'API' },
  {
    id: 'edit-restyle-warning',
    prompt: 'Make the database stand out as a warning.',
    patch: { flux: 1, ops: [{ op: 'restyle', targets: ['db'], style: { tone: 'warning' } }] },
    contain: 'Database',
  },
  {
    id: 'edit-relayout-right',
    prompt: 'Lay the screen out left to right.',
    patch: { flux: 1, ops: [{ op: 'setLayout', scope: 'main', layout: { type: 'layered', direction: 'right' } }] },
    contain: 'API',
  },
];

function editCase(e: (typeof EDITS)[number]): Authored {
  const c: EvalCase = { id: e.id, mode: 'edit', prompt: e.prompt, inputs: { document: BASE }, expect: { screens: [1, 1], mustContain: [e.contain] } };
  return { case: c, recording: scripted([request(JSON.stringify(e.patch))]) };
}

const REPAIRS: readonly { id: string; bad: string; contain: string }[] = [
  { id: 'repair-unknown-shape', bad: BASE.replace('rounded-rect, label: API', 'roundrect, label: API'), contain: 'API' },
  { id: 'repair-unknown-edge-end', bad: BASE.replace('api -> db', 'api -> databse'), contain: 'Database' },
  { id: 'repair-missing-flux-key', bad: BASE.replace('flux: 1\n', ''), contain: 'Service' },
  { id: 'repair-bad-edge-op', bad: BASE.replace('api -> db', 'api => db'), contain: 'Database' },
];

function repairCase(r: (typeof REPAIRS)[number]): Authored {
  const c: EvalCase = {
    id: r.id,
    mode: 'repair',
    prompt: 'Fix the file so it compiles; change nothing else.',
    inputs: { document: r.bad },
    expect: { screens: [1, 1], mustContain: [r.contain] },
  };
  return { case: c, recording: scripted([request(BASE)]) };
}

/** All the scripted cases: 20 generate (two need one repair round), 6 edit, 4 repair. */
export function authorAll(): Authored[] {
  return [...TOPICS.map((t, i) => generateCase(t, i === 3 || i === 11)), ...EDITS.map(editCase), ...REPAIRS.map(repairCase)];
}
