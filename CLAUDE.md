# Sevak: notes for Claude

Sevak is a volunteer management web app by The ANB Group: organizations publish events with roles
and shifts, volunteers sign up from their phones in under a minute, and hosts check them in and
confirm hours. Read `docs/REQUIREMENTS.md` (what to build, with IDs such as SGN-5) and
`docs/ARCHITECTURE.md` (how) before larger changes.

## Layout

- `apps/web`: Next.js app (pages, `/api/v1`, background jobs).
- `packages/db`: Drizzle schema (`src/schema.ts`), migrations, demo data.
- `packages/core`: business rules in plain TypeScript, no web code.
- `index.html`, `app/`: the static clickable prototype, deployed to GitHub Pages. Plain HTML, CSS
  and JavaScript with no build step; data lives in the browser's localStorage.
- `docs/`: requirements, architecture, diagrams.

## Commands

- `pnpm install`, `pnpm dev` (app with fake demo data on PGlite), `pnpm test`, `pnpm typecheck`.
- `pnpm db:generate` after changing `packages/db/src/schema.ts`; commit the migration it creates.

## Rules

- Work on a branch and open a pull request; never push to `main`.
- Never commit secrets or real personal data. Never use production data locally or in tests.
- Every API route that touches organization data checks the caller's role, and has a test that
  someone without access is refused.
- Validate every input on the server with Zod.
- Shift capacity is only changed through the atomic update in `packages/core` (never overbook).
- Store times in UTC; show them in the event's time zone.
- Phone first: check pages at 390px wide. Accessible: labels, keyboard use, contrast.
- Keep `docs/REQUIREMENTS.md` in step with features: add or update the requirement ID, and bump the
  version line at the top.
- Match the surrounding code's style. Prefer small, focused pull requests.
