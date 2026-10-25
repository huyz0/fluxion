# Design and acceptance

Follow ADR-0176. The bundle gate consumes size-limit JSON and classifies only the two
explicit embedding artifact names as advisory; player core and editor initial remain hard.
The expected four artifacts must each appear once with valid finite nonnegative byte counts
and configured targets. Extra/missing/duplicate artifacts, invalid JSON and unexpected tool
failures fail closed. Reports retain raw measurements and advisory overrun status.

Core mutation floor becomes the existing 90% target with this policy's explicit trailer;
other floors, full inventories, score calculation, integrity checks, execution timeouts and
zero retries stay unchanged. Nightly red evidence remains red. Feature dependencies become
logical product dependencies; M18.10 is still required for final closeout.

Update drive/verify/operator docs and generated skill adapters consistently: full milestone
checks at checkpoints/final, scoped precommit plus full CI for each commit, and independent
replanning after three unsuccessful attempts instead of repetitive user approval. Human
escalation still applies to actual decisions outside granted scope or denied actions.

Negative tests must distinguish advisory from blocking overruns and reject invalid/missing
measurement/tool failure. Keep original size-limit target tests and extend policy tests.
Preserve aggregate rejection probes and assert all non-core floors remain unchanged.
Archive this spec into the updated living standards after implementation.
