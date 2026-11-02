#!/usr/bin/env node
// M18.219 (cp31 F1): an osv-scanner excusal must be re-checked before it lapses, not after main turns red.
//   check-osv-expiry.mjs [--file osv-scanner.toml] [--today YYYY-MM-DD] [--days 7]
// Fails when any `ignoreUntil` or `effectiveUntil` date in the file is past or within `--days` of today.
// The security workflow runs it ahead of the scan, so a lapse shows a week early with the entries to re-check.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;

/** Every expiry in an osv-scanner.toml: the date, its line and the id or package it excuses. */
export function excusals(text) {
  const out = [];
  let label = '';
  text.split('\n').forEach((line, i) => {
    const name = /^\s*(id|name|version)\s*=\s*"([^"]+)"/.exec(line);
    if (/^\s*\[\[/.test(line)) label = '';
    if (name) label = label ? `${label} ${name[2]}` : name[2];
    const until = /^\s*(ignoreUntil|effectiveUntil)\s*=\s*(\d{4}-\d{2}-\d{2})/.exec(line);
    if (until) out.push({ line: i + 1, label, until: until[2] });
  });
  return out;
}

/** The excusals that are past or within `days` of `today` (both YYYY-MM-DD). */
export function expiring(text, today, days) {
  const now = Date.parse(`${today}T00:00:00Z`);
  return excusals(text).filter((e) => Date.parse(`${e.until}T00:00:00Z`) - now <= days * DAY);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : d;
  };
  const file = opt('file', 'osv-scanner.toml');
  const today = opt('today', new Date().toISOString().slice(0, 10));
  const days = Number(opt('days', '7'));
  const due = expiring(readFileSync(file, 'utf8'), today, days);
  for (const e of due) console.error(`FAIL ${file}:${e.line} ${e.label} expires ${e.until}: re-check it, then renew it with a reason or remove it`);
  if (due.length) process.exit(1);
  console.log(`PASS osv-expiry: no excusal in ${file} expires within ${days} days of ${today}`);
}
