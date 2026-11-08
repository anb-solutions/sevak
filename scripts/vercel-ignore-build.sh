#!/bin/bash
# Vercel's "Ignored Build Step" (apps/web/vercel.json → ignoreCommand).
# Only two branches deploy: main → Staging, production → Production.
# Every other branch is skipped, so there are no preview deployments.
# Vercel's rule: exit 1 = build, exit 0 = skip.
case "${VERCEL_GIT_COMMIT_REF:-}" in
  main|production)
    echo "Building ${VERCEL_GIT_COMMIT_REF}."
    exit 1
    ;;
  *)
    echo "Skipping ${VERCEL_GIT_COMMIT_REF:-unknown branch}: only main (staging) and production deploy."
    exit 0
    ;;
esac
