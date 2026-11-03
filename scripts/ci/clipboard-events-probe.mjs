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

/**
 * The editor's own route (M18.132, clipboard-catcher.ts): a focused non-editable canvas whose keydown moves the focus to a hidden text area with a
 * selected placeholder, a copy that writes the three representations the editor writes (its custom type, an HTML carrier with a template, text),
 * and a paste read back in the same page and in a second page of the same context. Each event is logged with its target, and the paste with what
 * each type holds, so the log tells whether the engine raises the event from a focus moved during keydown and whether the payload survives
 * (M18.242: every keyboard copy and paste spec fails on the previous Playwright's WebKit since M18.132).
 */
const CATCHER_PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<div id=canvas tabindex=0 style="width:200px;height:100px">canvas</div>
<script>
  window.__log = [];
  const area = document.createElement('textarea');
  area.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.append(area);
  const who = (t) => (t === area ? 'catcher' : t?.id || t?.tagName || String(t));
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !['c', 'x', 'v'].includes(e.key.toLowerCase())) return;
    area.value = ' ';
    area.focus({ preventScroll: true });
    area.select();
    window.__log.push('keydown->' + who(document.activeElement));
  });
  const TYPES = ['application/x-fluxion+json', 'text/html', 'text/plain'];
  for (const type of ['copy', 'cut']) {
    window.addEventListener(type, (e) => {
      if (e.clipboardData) {
        e.clipboardData.setData(TYPES[0], '{"probe":1}');
        e.clipboardData.setData(TYPES[1], '<b>x</b><template data-fluxion="1">{"probe":1}</template>');
        e.clipboardData.setData(TYPES[2], 'x');
      }
      window.__log.push(type + '@' + who(e.target));
      e.preventDefault();
    });
  }
  window.addEventListener('paste', (e) => {
    const held = e.clipboardData
      ? TYPES.map((t) => {
          const v = e.clipboardData.getData(t);
          return t + '=' + (v === '' ? '(empty)' : t === 'text/html' ? (v.includes('<template data-fluxion') ? 'template' : 'no-template') : v.length);
        }).join(',')
      : 'no clipboardData';
    window.__log.push('paste@' + who(e.target) + '{' + held + '}');
    e.preventDefault();
  });
  document.getElementById('canvas').focus();
</script>`;

/** The editor's route: copy and paste in one page, then a paste in a second page of the same context. */
async function catcherRoute(context) {
  // served from http://localhost, as the editor's e2e is: WebKit keys custom types and unsanitised HTML to the page's origin, and about:blank's is opaque
  await context.route('http://localhost/**', (route) => route.fulfill({ contentType: 'text/html', body: CATCHER_PAGE }));
  const run = async (page, keys) => {
    await page.goto('http://localhost/');
    const fired = [];
    for (const key of keys) {
      await page.evaluate(() => {
        window.__log.length = 0;
        document.getElementById('canvas').focus();
      });
      await page.keyboard.press(key);
      // the engine's default action may come after the keydown's task
      await page.waitForTimeout(100);
      fired.push(`${key} -> [${await page.evaluate(() => window.__log.join(' '))}]`);
    }
    return fired.join('; ');
  };
  const first = await context.newPage();
  first.setDefaultTimeout(5000);
  const same = await run(first, ['Control+c', 'Control+v']);
  const second = await context.newPage();
  second.setDefaultTimeout(5000);
  const other = await run(second, ['Control+v']);
  return { same, other };
}

/** What the async clipboard answers after a click, on a secure origin: the permission state, a write and a read of text; each gives up after 3 s. */
async function asyncClipboard(page) {
  // navigator.clipboard exists only in a secure context: about:blank is not one, http://localhost is (the editor's e2e runs from it)
  await page.route('http://localhost/**', (route) => route.fulfill({ contentType: 'text/html', body: '<button id=go>go</button>' }));
  await page.goto('http://localhost/');
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
      api: navigator.clipboard === undefined ? 'missing' : 'present',
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
    const routed = await catcherRoute(await browser.newContext());
    console.log(`  the editor's route (focus moved to a text area on keydown): ${routed.same}`);
    console.log(`  the editor's route, paste in a second page: ${routed.other}`);
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(5000);
    const answer = await asyncClipboard(page);
    console.log(`  async clipboard after a click: api=${answer.api}, permission=${answer.permission}, write=${answer.write}, read=${answer.read}`);
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
