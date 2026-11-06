---
status: accepted
date: 2026-11-06
decision-makers: stream 3 with stream 1 under Huy's full delegation of 2026-11-05 11:04:52Z ("you decide for me and unblock anything, don't ask me unless it is permission access")
---

# ADR-0217 — The pack-import refusal bound leaves out the first witness session's browser start

## Context and Problem Statement

ADR-0206 says the pack-import refusals exit 1 within 10 s. M18.229 has the e2e test time the
command's own work, from `start` to `end` with the witness close included, leaving out only
Node's start-up. The unpainted refusal is the only one that has to start the paint witness: a
headless Chromium launched through Playwright.

In ci 42178991600 at 255243b, verify (macos-latest), job 127763951655, that case took 23.9 s of
own work against 10 s: start 752, witness-ready 24525, disposed 24681, end 24681 (ms from the
process start, artifact 13485407154). So 23.8 s went into the browser start, and converting,
refusing and closing took 156 ms. The runner was slowed as a whole: the ladder took 961 s against
376 s on the run before (build 38 s against 13 s, harness-tests 793 s against 224 s), and the same
file's earlier corpus cases had already launched Chromium, so this was not a first-launch cost. On
the run before, the browser start took 1.2 s. Locally it takes 0.6 s, idle or on an oversubscribed
CPU.

The bound exists so that a hostile input cannot make a refusal slow. The first session's browser
start depends on nothing in the input: it runs before any member is read into the witness, with
only the theme and the fonts-core Inter face.

## Decision Drivers

- The bound is a security property: a hostile input must not slow a refusal. It is not a test of the runner.
- No raised bound, no retry, and no assertion dropped (AGENTS.md non-negotiable 2).
- A browser start that hangs must still fail.

## Considered Options

1. Warm or reuse the browser. pack-import is a fresh process per run, and the earlier corpus cases had already started Chromium on that runner, so warming would not have helped.
2. Raise the 10 s bound. Refused: that loosens the requirement.
3. Leave the first session's browser start out of the bound, as Node's start-up already is (chosen).

## Decision Outcome

Chosen option 3. The e2e bound is `end - start` less the interval from `witness-start` to `witness-ready`, the
first witness session's browser start. Everything else stays inside the 10 s:
- reading and checking the input;
- every member's conversion and paint;
- every later session's start (one per 128 members, so input-driven);
- the witness close;
- the outcome.

`pack-import` marks `witness-start` just before its first session starts. A unit test pins that
the interval holds that session's start and nothing else, that no member is painted before
`witness-ready`, and that the second session of a 129-member run starts after it. The unpainted
case asserts that the mark is present.

The browser start stays bounded by the witness itself. Launch and connect each have a 10 s
timeout, page setup has 10 s, and the whole setup has 118 s. A start that hangs therefore still
fails the command, and the test's exit-1 and message assertions catch it. The 10 s bound is not
raised.

## Consequences

- A slowed runner's browser start no longer fails a refusal bound that it cannot affect. A refusal
  that does more work for a hostile input still fails it.
- The ci log's ADVISORY line keeps the full phase split, `witness-start` included, so the browser
  start stays visible on every OS.
- M18.229's acceptance and ADR-0206's Confirmation point here.
