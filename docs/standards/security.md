# Security & privacy

> Read when: parsing or rendering anything from a file, clipboard, URL, AI response or plugin;
> touching `format`, sanitizers, the expression interpreter, CSP, the plugin host, AI provider
> settings, CI workflows or dependencies; before tagging a release.
> Family: Quality · Related: [tech-stack.md](tech-stack.md) §3, ADR-0003 (file format), ADR-0007 (plugin trust).

Threat model in one line: **a `.flux` / `.flux.html` file is attacker-controlled input that
people open and share**, and the editor holds AI keys. Anything that lets a file run code, read
other data, or phone home is a vulnerability.

## 1. Untrusted input

Untrusted = opened files, pasted/dropped content, imported Mermaid/Markdown/SVG, AI output,
plugin messages, URL parameters.

1. **Parse, then validate with Zod, before anything else touches it.** Loading never throws
   uncaught; invalid input returns `FluxError` + salvage (NFR-REL-002). → fast-check fuzz on
   loader (10k corrupted inputs)
2. **Sanitise SVG, HTML and rich text with an allowlist** (DOMPurify-style) in `format`
   (`sanitizeSvg`, `sanitizeHtml`) at load time *and* at render time for anything that reaches
   the DOM as markup. Allowlist, never denylist. → security corpus in CI
3. **Stripped always**: `<script>`, `<foreignObject>` with HTML, `on*` attributes, `javascript:`
   / `vbscript:` / `data:text/html` URLs, `<iframe>`, `<object>`, `<embed>`, `<use href>` to
   external docs, CSS `url()` / `@import` to remote hosts, `<animate>` targeting `href`. →
   security corpus
4. **External references are blocked unless the document explicitly allows them** and the
   user consented; assets are embedded and content-addressed. → E2E with network blocked
   (NFR-PORT-002)
5. **No `eval`, `new Function`, string `setTimeout`, or dynamic `import()` of document-supplied
   URLs.** → Biome `noGlobalEval` + review
6. **Bindings and conditions use the safe interpreter in `anim`**: parsed AST, whitelisted
   operators and functions, no property access to prototypes, step and time limits. → fuzz +
   DoS tests (NFR-SEC-007)

```ts
// ✅
const r = evaluateExpression(parse(src), scope, { maxSteps: 10_000, maxMs: 5 });
// ❌ new Function("scope", `return ${src}`)(scope)
```

7. **Zip hygiene**: reject path traversal (`../`, absolute paths), cap entry count, total
   uncompressed size and compression ratio (zip bombs), verify SHA-256 of content-addressed
   assets. → `format` unit tests with malicious fixtures
8. **`dangerouslySetInnerHTML` / `innerHTML` only with sanitised input**, via one wrapper
   component (`<SafeHtml>`). → Biome `noDangerouslySetInnerHtml` (wrapper allowlisted)

## 2. `.flux.html` Content-Security-Policy

9. **Every saved `.flux.html` ships a strict CSP meta tag** (NFR-SEC-002):

```
default-src 'none'; script-src 'sha256-…' (player + each embedded plugin bundle);
style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:;
connect-src 'none'; frame-src blob:; base-uri 'none'; form-action 'none'
```

   `connect-src` and `img-src` open to specific origins only when the author allowed remote
   resources. → CSP E2E (remote fetch blocked, injected inline script blocked)
10. **Script hashes are computed at save time** by `format`; no `'unsafe-inline'` or
    `'unsafe-eval'` for scripts, ever. → CSP E2E
11. **The editor PWA has its own CSP** (no `unsafe-eval`; `connect-src` limited to configured AI
    provider endpoints). → E2E header check

## 3. Plugin trust model (ADR-0007)

| Tier | Who | Runs | Access |
|---|---|---|---|
| First-party | `packs/*` in this repo | in-process | `@fluxion/sdk` only (`check-layering`) |
| Trusted | user-installed, signed, integrity-pinned | in-process | permissions from manifest, granted by user |
| Sandboxed | everything else (default) | `<iframe sandbox="allow-scripts">` on an opaque origin | typed `postMessage` protocol only |

12. **Every plugin has a manifest** with id, version, licence, permissions
    (`network:<origin>`, `storage`, `clipboard`, `ai`) and a SHA-384 **integrity hash** per
    bundle; the host refuses mismatches. → manifest schema + host unit tests
13. **Permissions are declared, shown and granted per plugin**; none by default. → E2E
14. **Sandboxed plugins cannot read parent DOM, storage, cookies or AI keys**; messages are
    validated with Zod on both sides. → security E2E (NFR-SEC-003)
15. **Plugin failures are contained** (error boundaries, sandbox); a plugin crash never
    white-screens the editor or player. → fault-injection tests (NFR-REL-004)

## 4. Secrets

16. **AI provider keys live only in local browser storage** (optionally encrypted with a
    user passphrase). Never in documents, exports, logs, telemetry, URLs or diagnostic reports. →
    test scanning saved fixtures + logs for key patterns (NFR-SEC-004)
17. **No secrets in the repo**: GitHub secret scanning with push protection; `.env*` ignored;
    test keys are obvious fakes (`sk-test-FLUXION-FAKE`). → secret scanning + review
18. **The logger redacts** fields named `key`, `token`, `authorization`, `apiKey`. → logger unit
    test

## 5. Supply chain (NFR-SEC-005)

19. **Lockfile committed; CI installs with `--frozen-lockfile`.** → CI
20. **pnpm `minimumReleaseAge` ≥ 1 day (target 3) and `blockExoticSubdeps: true`**; no
    `postinstall` scripts except allowlisted (`onlyBuiltDependencies`). → `check-drift`
21. **GitHub Actions pinned by full commit SHA**, least-privilege `permissions:` (default
    `contents: read`), workflows linted with zizmor. → CI `security.yml`
22. **Renovate** for updates, dependency review on PRs, **OSV-Scanner** and **CodeQL** on PR and
    schedule. → CI `security.yml`
23. **Licences checked** against the allowlist in `tech-stack.md`. → `check-licenses`
24. **Publishing only via npm trusted publishing (OIDC) with provenance**; no `NPM_TOKEN`; only
    the release job has `id-token: write`. → release workflow review + CODEOWNERS

## 6. Privacy

25. **No telemetry by default.** Any future telemetry is opt-in, anonymous, documented, and
    contains no document content. → network E2E: fresh install makes no third-party requests
    (NFR-SEC-006)
26. **Opening a file makes no network request** unless the document allows remote resources and
    the user agreed. → E2E with network blocked
27. **Diagnostic reports contain versions, stats and error codes — never document text.** →
    unit test (NFR-OBS-002)
28. **AI calls send only what the user asked to send**, and the AI panel shows what is sent. →
    review

## 7. Security test corpus

`specs/security/corpus/` holds hostile inputs; each file name states the attack. CI runs every
case through load → sanitise → render → save → reload and asserts nothing executes, no request
leaves, and the output is sanitised.

| Category | Examples |
|---|---|
| SVG / HTML XSS | `<svg onload>`, `<a href="javascript:">`, `<foreignObject>`, `<use href>` external, CSS `url()` exfil |
| Rich text | `<img onerror>`, mutation-XSS payloads, nested `<noscript>` |
| Zip | path traversal, zip bomb, duplicate entries, hash mismatch |
| Expressions | infinite loops, deep recursion, `__proto__` / `constructor` access |
| Plugins | forged manifest, integrity mismatch, sandbox escape attempts via `postMessage` |
| DSL / import | billion-laughs YAML aliases, huge Mermaid graphs |

29. **Every security bug fix adds its payload to the corpus.** Removing a case is blocked. →
    `check-tests-kept`

## 8. Security review checklist

Use for any PR touching §1–§5 areas (label `security`; CODEOWNERS review required):

- [ ] All new input paths validated with Zod and sanitised before DOM.
- [ ] No new `eval`-like sinks, `innerHTML`, or unsandboxed plugin surface.
- [ ] CSP unchanged, or change justified and tested.
- [ ] No secret or document text can reach logs, URLs, telemetry or saved files.
- [ ] New dependency passes licence, size and health rules; lockfile diff reviewed.
- [ ] Corpus extended for the attack class the change touches.
- [ ] Workflows: actions SHA-pinned, permissions minimal.
