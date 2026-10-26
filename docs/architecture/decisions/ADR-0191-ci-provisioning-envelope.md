---
status: accepted
date: 2026-10-26
decision-makers: user reasonable-gates instruction; independent plan review PASS0 (round2; streaming cancellation evidence added)
---

# ADR-0191 — Reserve verification time separately from browser provisioning

## Context and Problem Statement

CI40393442337 at27807af1 cancelled both Linux and Windows verification jobs at20minutes. Permitted job metadata records Linux Chromium installation821s followed by370s verification before cancellation. Windows installation206s plus798s failing verification was followed by115s of redundant harness execution before cancellation; the failure artifact step never ran. The Windows runtime assertions are real failures and remain a separate recovery task. M18.87 now preserves nested assertions and complete failed-step streams without that rerun.

## Decision Drivers

NFR-DX-003 automation, NFR-PORT-005 cross-platform verification, NFR-MNT-004 honest evidence. Preserve every full-ladder check, the900000ms verification limit,600000ms cold-setup limit, zero retries and all correctness/security assertions.

## Considered Options

1. Repeat unchanged jobs. No changed input addresses either observed envelope exhaustion; rejected.
2. Reduce test selection or relax verification runtime. Loses qualification or weakens its bound; rejected.
3. Separate bounded provisioning and verification within a35minute outer job, and upload existing failure logs without a second harness execution. Chosen: extra allowance covers measured provisioning while verification stays bounded; a slower failed install may consume more runner minutes.

## Decision Outcome

Only the three-OS verify matrix changes:35minute outer envelope,15minute Chromium provisioning step,15minute pnpm verify step,2minute report upload. Five minutes of outer headroom cover checkout/toolchain/install/cleanup; full cold setup remains its independent unchanged job. The step bound matches the unchanged900000ms verification allowance, not a new performance threshold. Remove the post-failure harness rerun: pnpm verify already runs the full harness once and preserves its failure streams. Upload logs on failure or cancellation with a bounded always-condition, without continue-on-error. Persist each active step's stdout/stderr to separate partial stream files as decoded chunks arrive, using an asynchronous-context-local sink in runAsync so parallel steps cannot mix streams. Start the files before execution; completed failure logs remain unchanged. The sink must not alter commands, selection, exit status or encoding; filesystem errors preserve normal buffered diagnostics and emit a warning. These partial files survive interruption before a subprocess returns. Test an actual child emitting diagnostics while still running, then interrupt its supervisor and confirm persisted bytes remain without a rerun. Missing artifacts warn; they never convert a failed or cancelled verification to success. The aggregate still requires all jobs to succeed.

Backlog growth from86 to87 rows is evidence-driven recovery, not new product scope. M18.80 is preserved and locally qualified, pending recovery publication. Remaining feature prerequisites are unchanged.

## Consequences and Confirmation

Workflow tests constrain the three OS entries, unchanged pnpm verify invocation,900s step, bounded provisioning/reporting, no post-failure duplicate harness and unchanged aggregate. Existing failure-report probes retain nested assertions and error exit status. Deliberately mutate step limits, report condition and duplicate execution in isolated fixtures to prove guards reject them. Workflow lint, staged verification and independent code review precede publication. Native Windows cleanup remains unresolved until its separate repair and CI evidence pass; neither this policy nor cancelled jobs qualify it.
