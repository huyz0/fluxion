// M18.219 (cp31 F1): osv-scanner excusals are flagged a week before they lapse. HARNESS, NFR-SEC-005
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { excusals, expiring } from '../../scripts/gates/check-osv-expiry.mjs';

const TOML = `[[IgnoredVulns]]
id = "GHSA-aaaa"
ignoreUntil = 2026-12-02
reason = "x"

[[PackageOverrides]]
name = "pkg"
version = "1.0.0"
ecosystem = "npm"
vulnerability.ignore = true
effectiveUntil = 2026-11-09
reason = "y"
`;

describe('check-osv-expiry (M18.219, NFR-SEC-005)', () => {
  it('lists each expiry with its id or package and line', () => {
    assert.deepEqual(excusals(TOML), [
      { line: 3, label: 'GHSA-aaaa', until: '2026-12-02' },
      { line: 11, label: 'pkg 1.0.0', until: '2026-11-09' },
    ]);
  });
  it('flags an excusal within 7 days, and one already past, but not one further out', () => {
    assert.deepEqual(expiring(TOML, '2026-11-01', 7), []);
    assert.deepEqual(
      expiring(TOML, '2026-11-02', 7).map((e) => e.label),
      ['pkg 1.0.0'],
    );
    assert.deepEqual(
      expiring(TOML, '2026-12-03', 7).map((e) => e.label),
      ['GHSA-aaaa', 'pkg 1.0.0'],
    );
  });
  it('the security workflow runs it ahead of the scan', () => {
    const yml = readFileSync('.github/workflows/security.yml', 'utf8');
    const job = yml.slice(yml.indexOf('  osv-scanner:'), yml.indexOf('  dependency-review:'));
    assert.ok(job.indexOf('check-osv-expiry.mjs') > 0 && job.indexOf('check-osv-expiry.mjs') < job.indexOf('osv-scanner-action'));
  });
  it("reads the excusals of the repository's osv-scanner.toml", () => {
    assert.ok(excusals(readFileSync('osv-scanner.toml', 'utf8')).length > 0);
  });
});
