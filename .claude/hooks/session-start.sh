#!/bin/bash
# Installs dependencies when a Claude Code session starts in the cloud, so
# Claude can run `pnpm dev` and `pnpm test` straight away.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
