## What changed

## Why

## How I checked it
- [ ] `pnpm typecheck` and `pnpm test` pass
- [ ] `tests/run.sh` passes (the pages)
- [ ] `pnpm build` and `tests/e2e/run.sh` pass on a fresh database
- [ ] Changed pages checked at 390px wide

## Security and privacy
- [ ] No secrets or real personal data in this change
- [ ] New API routes check the caller's role and validate input, with a test for refused access
- [ ] Not applicable
