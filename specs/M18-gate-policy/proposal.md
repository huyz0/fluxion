# Proportionate development gates

The user explicitly authorized clearing the M18.64 stop and rationalizing disproportionate
gates. ADR-0176 defines the classifications, measured impact and preserved checks.
NFR-SIZE-001/002, NFR-MNT-005 and NFR-DX-002/003 are affected. No runtime migration,
security/license relaxation, deleted assertions, force push, release or deployment.

M18.65 reviews this policy; M18.66 implements it; M18.64 then ships the endpoint fix.
M18.10 remains an honest complete-report/floor qualification requirement for final closeout,
not a dependency of unrelated feature implementation. Existing red runs remain red.
