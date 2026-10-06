#!/usr/bin/env node
// What a browser does with Ctrl+C, Ctrl+X and Ctrl+V on a bare page (FR-EDT-007, NFR-PORT-001, M11.59). The editor copies and pastes only when the browser fires the
// `copy` and `paste` events, and the nightly's older WebKit (Playwright 1.62.1) fails the three clipboard specs while the pinned one passes them. This prints, for each
// starting state of the page (nothing selected, a selection, an editable field), which events fired and what the paste could read, so a log shows the engine's behaviour
// without a trace; and what the async clipboard (navigator.clipboard) answers after a click, which a paste between two pages depends on. It never fails the run: the nightly's webkit job calls it after the suite, only when the suite failed.
//   BROWSER=webkit|chromium|firefox   the engine (default webkit)
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const ENGINES = { chromium, firefox, webkit };

const PAGE = `<!doctype html><meta charset=utf-8><body tabindex=0 style="margin:0">
<p id=text>some text to select</p><div id=canvas tabindex=0 style="width:200px;height:100px">canvas</div><input id=field value="a field">
<script>
  window.__log = [];
  for (const type of ['copy', 'cut', 'paste']) {
    window.addEventListener(type, (e) => {
      if (type !== 'paste' && e.clipboardData) e.clipboardData.setData('text/plain', 'payload');
      window.__log.push(type + (type === 'paste' && e.clipboardData ? ':' + (e.clipboardData.getData('text/plain') || '(empty)') : ''));
      e.preventDefault();
    });
  }
</script>`;

/** The states the page is put in before the keys are pressed: a name and the steps that make it. */
const STATES = [
  {
    name: 'nothing selected, body focused',
    run: (page) =>
      page.evaluate(() => {
        document.body.focus();
        getSelection()?.removeAllRanges();
      }),
  },
  {
    name: 'nothing selected, a focused div',
    run: (page) =>
      page.evaluate(() => {
        document.getElementById('canvas')?.focus();
        getSelection()?.removeAllRanges();
      }),
  },
  { name: 'text selected', run: (page) => page.evaluate(() => getSelection()?.selectAllChildren(document.getElementById('text'))) },
  { name: 'editable field focused', run: (page) => page.evaluate(() => document.getElementById('field')?.focus()) },
];

/** The events one state fires for the three shortcuts, in order. */
async function probe(page, state) {
  await page.setContent(PAGE);
  await state.run(page);
  const fired = {};
  for (const [label, key] of [
    ['copy', 'Control+c'],
    ['cut', 'Control+x'],
    ['paste', 'Control+v'],
  ]) {
    await page.evaluate(() => (window.__log.length = 0));
    await page.keyboard.press(key);
    fired[label] = await page.evaluate(() => [...window.__log]);
  }
  return fired;
}

/** What the async clipboard answers after a click: the permission state, a write and a read of text; each gives up after 3 s. */
async function asyncClipboard(page) {
  await page.setContent('<button id=go>go</button>');
  await page.click('#go');
  return page.evaluate(async () => {
    const within = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, 3000, '(no answer in 3 s)'))]);
    const describe = async (step) => {
      try {
        return await within(step());
      } catch (e) {
        return `error:${e?.name}`;
      }
    };
    return {
      permission: await describe(async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state),
      write: await describe(async () => {
        await navigator.clipboard.writeText('probe');
        return 'ok';
      }),
      read: await describe(async () => JSON.stringify(await navigator.clipboard.readText())),
    };
  });
}

async function main() {
  const name = process.env.BROWSER ?? 'webkit';
  const browser = await ENGINES[name].launch();
  try {
    console.log(`clipboard-events-probe: ${name} ${browser.version()}`);
    for (const state of STATES) {
      const page = await (await browser.newContext()).newPage();
      // an engine that does not answer must not hold the job: each action gives up after 5 s
      page.setDefaultTimeout(5000);
      const fired = await probe(page, state);
      console.log(`  ${state.name}: copy -> [${fired.copy}], cut -> [${fired.cut}], paste -> [${fired.paste}]`);
      await page.close();
    }
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(5000);
    const answer = await asyncClipboard(page);
    console.log(`  async clipboard after a click: permission=${answer.permission}, write=${answer.write}, read=${answer.read}`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.log(`clipboard-events-probe: could not run: ${e?.message ?? e}`);
    })
    // the driver's pipes can keep the process alive after an error: the probe never holds the job
    .finally(() => process.exit(0));
}
