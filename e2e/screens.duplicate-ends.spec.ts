import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Records = Record<string, Record<string, unknown>>;
type Hooks = { records(): Records; applyRecords(puts: readonly object[]): string | undefined };
const recordsOf = (page: Page): Promise<Records> => page.evaluate(() => (window as unknown as { __fluxion: Hooks }).__fluxion.records());

/** Add a deterministic non-centre external binding through the existing command test hook. */
async function prepare(page: Page, editor: EditorPage): Promise<Records> {
  await page.addInitScript(() => {
    (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
  });
  await editor.open('new');
  const records = await recordsOf(page);
  const first = Object.values(records).find((r) => r['type'] === 'screen')?.['id'];
  expect(typeof first).toBe('string');
  const puts = [
    { id: 'OutsideScreen001', type: 'screen', name: 'Outside', index: 'a1', size: { w: 1600, h: 900 } },
    { id: 'InsideShape00001', type: 'element', kind: 'shape', screenId: first, index: 'a0', defId: 'basic:rect', transform: { x: 50, y: 60, w: 100, h: 80 } },
    {
      id: 'OutsideShape001',
      type: 'element',
      kind: 'shape',
      screenId: 'OutsideScreen001',
      index: 'a0',
      defId: 'basic:rect',
      transform: { x: 400, y: 300, w: 200, h: 100 },
    },
    { id: 'OutsideLink00001', type: 'element', kind: 'connector', screenId: first, index: 'a1', route: { type: 'straight' } },
    {
      id: 'LinkSource000001',
      type: 'binding',
      connectorId: 'OutsideLink00001',
      end: 'source',
      elementId: 'InsideShape00001',
      anchor: { kind: 'point', x: 1, y: 0.25 },
    },
    {
      id: 'LinkTarget000001',
      type: 'binding',
      connectorId: 'OutsideLink00001',
      end: 'target',
      elementId: 'OutsideShape001',
      anchor: { kind: 'point', x: 0.25, y: 0.75 },
    },
  ];
  const error = await page.evaluate((values) => (window as unknown as { __fluxion: Hooks }).__fluxion.applyRecords(values), puts);
  expect(error).toBeUndefined();
  await expect(editor.screenTab('Outside')).toBeVisible();
  return recordsOf(page);
}

test.describe('external screen endpoints', { tag: '@desktop' }, () => {
  test('FR-SCR-002, FR-CON-001: navigator duplicates an outside-bound connector at its routed point and undoes exactly', async ({
    page,
    expectAccessible,
  }, info) => {
    const editor = new EditorPage(page);
    const before = await prepare(page, editor);
    await editor.screenTab('Screen 1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    await expect.poll(async () => Object.values(await recordsOf(page)).filter((r) => r['type'] === 'screen').length).toBe(3);
    const after = await recordsOf(page);
    const copiedScreen = Object.values(after).find((r) => r['type'] === 'screen' && !before[String(r['id'])]);
    expect(copiedScreen).toBeDefined();
    const copied = Object.values(after).find((r) => r['kind'] === 'connector' && r['screenId'] === copiedScreen?.['id']);
    expect(copied?.['freeTarget']).toEqual({ x: 450, y: 375 });
    expect(copied).not.toHaveProperty('freeSource');
    const bindings = Object.values(after).filter((r) => r['type'] === 'binding' && r['connectorId'] === copied?.['id']);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.['end']).toBe('source');
    expect(after[String(bindings[0]?.['elementId'])]?.['screenId']).toBe(copiedScreen?.['id']);
    for (const [id, value] of Object.entries(before)) expect(after[id]).toEqual(value);
    await expect(editor.screens.first()).toHaveAttribute('data-screen-id', String(copiedScreen?.['id']));
    await expectAccessible();
    await page.screenshot({ path: `.harness/artifacts/M18.64/${info.project.name}-duplicate.png` });
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => recordsOf(page)).toEqual(before);
    await editor.toolbarButton('Redo').click();
    await expect.poll(() => recordsOf(page)).toEqual(after);
  });
});
