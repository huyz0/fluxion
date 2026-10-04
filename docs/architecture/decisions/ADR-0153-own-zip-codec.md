---
status: accepted
date: 2026-10-04
decision-makers: harness (M10.23; within FR-FIL-003, FR-FIL-009, NFR-REL-002, tech-stack.md §1 and architecture/08-file-format.md §2; no runtime dependency)
---

# ADR-0153 — The zip container is read and written by our own codec in `@fluxion/format`, not by fflate

## Context and Problem Statement

architecture/08 §2 and tech-stack.md name fflate for the `.flux` zip. `format` is a pure package (no DOM, no `node:*`), and its
`lib` has neither `TextEncoder` nor `CompressionStream`. fflate is resolved in the lockfile only as a transitive dependency of a
development tool; making it a dependency of `format` changes the lockfile's catalog and importers, which re-opens the
gate-budget record for an external change, and the cloud container that builds this repository cannot re-record it (the ladder
for such a change takes about twice its 120 s budget there). The loader also needs two things a library gives only partly:
a hard cap on the inflated size of every entry (zip bombs, FR-FIL-009) and a decoder that never throws (NFR-REL-002).

## Decision Drivers

- Byte-identical output for identical input in every host (FR-FIL-003), so goldens and hashes hold across Node versions and
  browsers; the native `CompressionStream` and zlib versions do not promise that.
- A decoder that refuses, with a reason, instead of throwing, and that stops at an output cap.
- No new package, no lockfile change beyond workspace links.
- Small and testable: DEFLATE is a 30-year-old format with a public reference decoder (zlib's `puff.c`) and an exact test
  oracle (every zlib stream must decode, every stream we write must be accepted by zlib).

## Considered Options

1. **fflate as a dependency of `format`.** The documented plan; fast, MIT, small. Costs the lockfile change above.
2. **Native `CompressionStream('deflate-raw')` and `DecompressionStream`.** Async, not in this package's `lib`, output differs
   between engines and versions, and no output cap.
3. **Store-only zip (method 0).** Trivial and deterministic, but a document is two to five times larger; the size budget
   (NFR-SIZE-003, `.flux` at most 150 kB for 20 screens) needs compression.
4. **Our own codec**: a DEFLATE encoder and decoder (about 300 lines) and the zip container (about 200).

## Decision Outcome

Option 4, in `packages/format/src` (`deflate.ts`, `inflate.ts`, `crc32.ts`, `utf8.ts`, `zip.ts`), behind two public functions,
`writeZip` and `readZip`; the codec itself is not exported.

- **Encoder.** LZ77 over a 32 kB window found by hash chains (3-byte hash, at most 48 candidates, matches 3 to 258, a 3-byte
  match farther than 4 kB is not taken), coded with the fixed Huffman code in one final block. No host-dependent tuning, so the
  output is a pure function of the input. Dynamic Huffman is a later improvement if the size budget needs it; any change to the
  encoder changes the bytes of every `.flux`, so it is a format-fixture change (ADR + goldens, non-negotiable 6).
- **Decoder.** Stored, fixed and dynamic blocks, an `maxOut` cap checked on every byte written, a `reason` for every fault;
  it reads whatever zlib or any other writer produced. Canonical codes decoded as `puff.c` does.
- **Container.** Entries in the order given, fixed timestamp 1980-01-01, UTF-8 name flag, no extra fields, no zip64
  (65 535 entries or 4 GB is refused); an entry is deflated only when that is smaller, else stored; `mimetype` is written
  stored by the caller (`method: 'store'`). `readZip` checks every entry's declared size and CRC-32 and takes limits for the
  entry count, one entry and the total; path policy (`..`, absolute, duplicates) is the loader's (M10.6).
- **Oracle.** `zip.test.ts` decodes zlib-written fixtures (a zip with dynamic, stored and empty entries; a fixed-Huffman and a
  stored raw stream), pins the exact bytes of a one-entry zip that Python's `zipfile` (zlib) accepted, and fuzzes the decoder and
  the reader with random and corrupted input.
- **Documents amended.** architecture/08 §2 ("implemented with fflate") and the tech-stack.md zip row now say this. fflate
  may replace the codec later behind the same two functions; because the encoder's bytes would change, that is a deliberate,
  fixture-changing step.

### Consequences

- Good: no lockfile or budget change; one deterministic writer; the hostile-input rules are in the decoder, where they cannot be
  forgotten.
- Good: `format` stays pure and runs in the player, the CLI and the studio alike.
- Bad: we own about 500 lines of compression code; compression is roughly 15 to 25 percent worse than zlib level 6 until a dynamic
  Huffman block is written.
- Bad: decoding is bit by bit (puff style), a few tens of milliseconds per megabyte; fine for documents, not for video, which
  is stored anyway.

### Confirmation

- `FR-FIL-003: deflate then inflate returns the bytes` (fast-check), `FR-FIL-003: inflate reads fixed, stored and dynamic blocks
  written by zlib`, `FR-FIL-003: a zip written twice is byte-identical, with mimetype first, stored and without an extra field`,
  `FR-FIL-003: a one-entry zip has exactly these bytes`.
- `NFR-REL-002: inflate refuses broken streams with a reason and never throws` and `NFR-REL-002: readZip never throws on
  truncated, corrupted or hostile bytes`; `FR-FIL-009: readZip refuses what exceeds its limits and says which`.
