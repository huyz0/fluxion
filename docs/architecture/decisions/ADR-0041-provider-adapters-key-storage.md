---
status: accepted
date: 2026-10-16
decision-makers: harness (M15.5; within FR-AI-007 and NFR-SEC-004; no requirement changes)
---

# ADR-0041 — Provider adapters and key storage: the `LlmClient` port, adapters in the studio, an IndexedDB key store

## Context and Problem Statement

The studio's AI panel (FR-EDT-014) and the live eval mode call a language model. FR-AI-007 asks for adapters for Anthropic, OpenAI and OpenAI-compatible or local endpoints, with keys supplied by the user and stored locally only. NFR-SEC-004 requires that a key is never written into a document, a log or telemetry, and that a test scans saved files and logs for key patterns. The generation orchestrator (M15.12) is in a pure-core package and must not know about HTTP or storage.

## Decision Drivers

- Libraries stay pure and provider-neutral; network and storage belong to the app (AGENTS.md rule 5).
- A key is the user's money. It must have one place to live, one way to leave (a request header to the provider the user chose), and no other.
- A saved `.flux.html` has `connect-src 'none'` (08-file-format.md §3); the assistant lives in the studio, never in a published file.
- Adapters must be testable without a network or a real key.
- Provider streaming and structured-output features differ; the port must say what each adapter can do rather than pretend they are equal.

## Considered Options

1. **Provider SDKs in the studio.** Large, each with its own streaming and error types, and they read keys from environment conventions we do not want in a browser.
2. **A small `LlmClient` port with `fetch`-based adapters (chosen).** Three adapters, each a few hundred lines over `fetch` and server-sent events, with an injected `fetch` for tests.
3. **A proxy service holding keys.** Needs a backend and moves the trust; out of scope for a local-first tool.

## Decision Outcome

Option 2.

**The port.** `LlmClient` is defined in `@fluxion/dsl` (types only, no I/O): `{ id: string; capabilities: { structuredOutput: boolean; vision: boolean }; stream(req: LlmRequest, signal: AbortSignalLike): AsyncIterable<LlmChunk> }`. `LlmRequest` holds the system prompt (first, so providers can cache it), the messages, an optional JSON Schema for structured output, a `maxTokens`, and an optional image. `LlmChunk` is `{ type: 'text'; text } | { type: 'usage'; tokensIn; tokensOut } | { type: 'done' }`; an error is a thrown `LlmError` with a code (`auth`, `rate-limit`, `network`, `aborted`, `bad-response`). Its message is built from the code and the HTTP status alone, never from the provider's response body or the request headers (providers echo key fragments in 401 bodies). `LlmError` is a small runtime class exported by `@fluxion/dsl` beside the types (a public API addition, recorded in the api report in M15.12); the pure packages compile with `lib: ["ES2023"]` and no DOM or node typings, so `AbortSignal` is not declared there: the port takes a minimal structural `AbortSignalLike` (`aborted` and `addEventListener`/`removeEventListener` for `abort`, as `@fluxion/layout` already does) that the platform `AbortSignal` satisfies, uses `AsyncIterable` from ES2023, and does no I/O. The orchestrator and the eval harness depend on this port only.

**Adapters.** `apps/studio/src/ai/anthropic.ts`, `openai.ts` and `openai-compatible.ts` (a base URL and optional key, for local servers). Each takes `{ fetch, apiKey, model, baseUrl? }`, builds the provider's request, parses its event stream into `LlmChunk`s, and maps HTTP and stream failures to `LlmError`. When structured output is requested and the adapter does not support it, `capabilities.structuredOutput` is false and the orchestrator falls back to plain text plus validation (ADR-0035). Abort signals cancel the request. The adapters live in the app, not in a library: a library that imports `fetch` or an endpoint is not pure.

**Key storage.** A key store in `apps/studio/src/ai/key-store.ts` over IndexedDB (database `fluxion-ai`, store `keys`, one record per provider id). A record is `{ provider, value }` in plain form, or `{ provider, iterations, salt, iv, ciphertext }` when the user sets a passphrase: PBKDF2-SHA-256 (600 000 iterations, stored in the record as `iterations` so it can be raised later; per-record random 16-byte salt) derives an AES-GCM-256 key through Web Crypto with a fresh random 12-byte IV drawn for every encryption (a re-set record never reuses one), and the passphrase is held in memory only for the session. Nothing is read from `localStorage`, cookies or the URL. The store exposes `get`, `set`, `remove` and `clear`; `get` returns the key to the adapter factory only. A key is never placed in a React/Preact state that is serialised, in the document store, in the autosave record, or in the diagnostic report, and the dev logger and the report builder drop any value that matches the key patterns below.

**Leak prevention and its test.** Redaction is by **exact value first**: the key store registers every key it holds (and the passphrase-decrypted value) with a `redactor`, and the logger and the diagnostic report builder replace any string containing a registered value, whatever its shape (local servers and other providers use keys with no known prefix). A second layer, `looksLikeKey` (the prefixes `sk-ant-` and `sk-`, and long base62 strings that follow `key`, `token` or `authorization`), catches a key that was never registered. The e2e test `key-leak.spec.ts` seeds two fake keys, one with a provider prefix and one with none (`k9x…` hex), runs the assistant with a mocked provider, saves `.flux`, `.flux.html` and `.flux.json` through the real file path, collects the console log and the diagnostic report, and asserts the fake key appears in none of them. A unit test feeds each adapter a mocked 401 whose body echoes the key and asserts the thrown `LlmError` message does not contain it.

**Network permission.** The studio page may connect to the provider hosts the user configured; this is the studio's own CSP, separate from the strict CSP of exported files (`connect-src 'none'`). The assistant is not part of any exported file.

### Consequences

- Good: the orchestrator is testable with a scripted client and the eval harness reuses the same port.
- Good: one storage location, one exit path for a key, and a test that scans every artifact.
- Good: no provider SDK weight in the studio bundle.
- Bad: three adapters are ours to keep current as providers change event formats; recorded fixtures per adapter pin today's format.
- Bad: IndexedDB with a passphrase is local protection, not a vault: someone with the unlocked browser profile can use the key. The UI says so.
- Bad: a user who forgets the passphrase must re-enter the key; there is no recovery by design.

### Confirmation

M15.12 (the orchestrator over the port), M15.19 (per-adapter mocked-fetch tests including the echoing-401 case, key store round trip with and without a passphrase, the redactor), M15.20 (`key-leak.spec.ts`, `key-leak.test.ts`: the logger and report filtering), M15.21 (the panel uses the factory, not the store directly).

## More Information

ADR-0035 (repair and structured output), ADR-0039 (the eval harness uses the port), 06-ai-authoring.md §11, 08-file-format.md §3, FR-AI-007, NFR-SEC-004, FR-EDT-014.
