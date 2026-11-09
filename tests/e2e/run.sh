#!/usr/bin/env bash
# Runs the end-to-end tests: real browsers against the real app (next start)
# and a real PostgreSQL at DATABASE_URL. Sign-in codes come from the app's
# log (EMAIL_MODE=log).
#
#   pnpm build && DATABASE_URL=postgres://... tests/e2e/run.sh
#
# Needs Playwright with Chromium (NODE_PATH should find playwright; by
# default it uses the global npm folder).
set -u
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?Set DATABASE_URL to a PostgreSQL database for testing}"
LOG="$(mktemp)"
PORT="${E2E_PORT:-3100}"
E2E_STAFF="e2e-staff-$(date +%s)@example.com"

pnpm db:migrate >/dev/null || exit 1
(
  cd apps/web &&
    PORT="$PORT" EMAIL_MODE=log SEVAK_ENV=test SEVAK_PLATFORM_ADMINS="$E2E_STAFF" \
      exec npx next start >"$LOG" 2>&1
) &
APP=$!
trap 'kill $APP 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 1
done

export NODE_PATH="${NODE_PATH:-$(npm root -g)}" E2E_BASE="http://localhost:$PORT" E2E_LOG="$LOG" E2E_STAFF
fail=0
for t in tests/e2e/*.e2e.js; do
  out=$(timeout 300 node "$t" 2>&1)
  code=$?
  if [ $code -ne 0 ] || echo "$out" | grep -qE "^FAIL"; then
    echo "✗ $(basename "$t")"
    echo "$out" | grep -E "FAIL|Error" -A4 | head -12 | sed 's/^/    /'
    fail=1
  else
    echo "✓ $(basename "$t")  $(echo "$out" | grep -E '^[0-9]+ ok' | head -1)"
  fi
done
exit $fail
