#!/usr/bin/env bash
# Runs inside the pinned Playwright image (ci.yml's): the repo is mounted read-only at /src, copied
# without installs and builds, installed, built, and tested with the Playwright arguments given.
# Reports and snapshots written under /out reach the host (scripts/e2e/image.mjs).
set -euo pipefail
mkdir -p /work
cd /src
tar --exclude=./node_modules --exclude='*/node_modules' --exclude=./.git --exclude='*/dist' --exclude='*/.tsbuild' \
  --exclude=./.turbo --exclude='*/.turbo' --exclude=./test-results --exclude=./playwright-report -cf - . | (cd /work && tar xf -)
cd /work
corepack enable >/dev/null 2>&1 || npm i -g pnpm@11 >/dev/null
pnpm install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -30 /tmp/install.log; exit 1; }
pnpm run build >/tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
status=0
pnpm exec playwright test "$@" || status=$?
# updated snapshots go back to the host when asked
if [ "${FLUXION_E2E_COPY_SNAPSHOTS:-}" = "1" ]; then cp -r e2e/*-snapshots /out/ 2>/dev/null || true; fi
exit "$status"
