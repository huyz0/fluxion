# Design

Adopt ADR0190: quick latency is advisory for all quick invocations. Keep180000 target; report actual,target,overrun in normal/summary/GitHub output. Do not alter subcheck success or selection. Staged900000 and cold600000 remain hard.

Use a testable timing-policy helper shared by precommit and M0. Preserve subprocess exit status in M0 and surface captured advisory output. Budget validation requires positive finite measured values; null,missing,strings,zero,negative and nonfinite values fail. Successful quick over-target measurements are numeric and advisory; failed subprocesses still record null. No new baseline schema or historical conversion. Preserve stale-lock and cold-pending restrictions.

Change precommit,check-budget,M0 and focused harness tests; update requirement,standards,ADR0164 supersession,threshold comment and verification skill/adapters. No numerical threshold changes, workflow changes or runtime dependencies. Commit carries Threshold-change: ADR0190 to disclose semantic relaxation.

Negative probes: below/equal/above target; failed subcheck below/above target stays failing; missing/invalid/null measurement remains failing; staged900001/cold600001 fail even alongside advisory; recorder failed run remains null; M0 forwards warnings and rejects failed process; summary and GitHub escaped warnings retain actual numbers. Assert unchanged quick command/selection and worst-case staged arguments. Run focused probes then exact staged verification,fresh independent code review,normal hooks and CI. Remeasure after policy; do not transplant old failed durations into qualifying fields.

Risk: quick latency regressions no longer block commits. Visible warnings retain regression evidence; staged/cold limits still bound delivery verification. Profile expensive tests as follow-up without weakening fidelity.
