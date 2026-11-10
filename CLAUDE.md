# Sevak: notes for Claude

Sevak is a volunteer management web app by The ANB Group: organizations publish events with roles
and shifts, volunteers sign up from their phones in under a minute, and hosts check them in and
confirm hours. Read `docs/REQUIREMENTS.md` (what to build, with IDs such as SGN-5) and
`docs/ARCHITECTURE.md` (how) before larger changes. `CONTRIBUTING.md` has the contributor flow.

## Layout

Two things live in this repo: the **clickable prototype** and the **real app** that replaces it.

- `index.html`, `app/`: the prototype. Plain HTML, CSS and JavaScript, no build step; data lives in
  the browser's localStorage. Served by the app on staging after every merge. Its browser tests are in
  `tests/` (Playwright; `tests/run.sh <screenshot-dir>`).
- `apps/web`: the real app. Next.js: pages, the `/api/v1` API. During the pilot it serves a copy
  of the prototype's pages (`scripts/copy-prototype.mjs`), which move to React one at a time.
  `apps/web/prototype/sync.js`, added to each copied page, keeps chosen browser-storage keys on
  the server (`/api/v1/sync`); `packages/core/src/records.ts` decides who sees and changes them.
- `packages/db`: Drizzle schema (`src/schema.ts`) and SQL migrations. `@sevak/db/memory` is the
  in-memory database for local development and tests only.
- `packages/core`: business rules in plain TypeScript, no web code (sign-in, sign-up and capacity,
  synced records, seed data, time zones, tokens), and `src/tasks.ts` (migrate and seed).
- `Dockerfile`, `infra/gcp/`, `.github/workflows/deploy.yml`: deployment to Google Cloud Run with
  Cloud SQL PostgreSQL. Guide: `infra/gcp/README.md`; every variable and secret an environment
  needs (for production, or another): `docs/ENVIRONMENTS.md`. Keep it up to date when you add one.
- `docs/`: requirements, architecture, UML diagrams.

## Commands

- `pnpm install`, `pnpm dev` (the app on http://localhost:3000, with demo data in an in-memory
  database; no Docker, accounts or keys), `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Browser tests: `tests/run.sh <screenshot-dir>` (the prototype's pages) and, after `pnpm build`,
  `DATABASE_URL=… tests/e2e/run.sh` (whole flows with several people against the real app and a
  real PostgreSQL). CI runs both on every pull request. Add an end-to-end test for each new flow.
- `pnpm db:generate` after changing `packages/db/src/schema.ts`; commit the migration it creates.
- `pnpm db:migrate` and `pnpm db:seed` against `DATABASE_URL` (seed only runs with
  `SEVAK_ENV=staging`).

## How changes ship

Branch → pull request → CI (typecheck, tests, build, container image, secret scan) → review →
merge into `staging` (the default branch) → deployed to **staging** automatically. Only the owner
releases to **production**, by merging `staging` into `main`; `main` always holds what's live.
There are no preview deployments.

## Rules

- Branch from `staging` and open a pull request into `staging`; never push to `staging` or `main`.
- Never commit secrets or real personal data. Never use production data locally or in tests.
- Every API route that touches organization data checks the caller's role, and has a test that
  someone without access is refused.
- Validate every input on the server with Zod.
- Shift capacity is only changed through the atomic update in `packages/core` (never overbook).
- Store times in UTC; show them in the event's time zone.
- Database migrations must work while the previous version is still running: add first, remove in
  a later release. Never edit a merged migration.
- Phone first: check pages at 390px wide. Accessible: labels, keyboard use, contrast.
- Wherever "Add to calendar" appears (pages or emails), offer both an .ics file and a Google Calendar
  link, in the event's time zone (SGN-9).
- Keep `docs/REQUIREMENTS.md` in step with features: add or update the requirement ID, and bump the
  version line at the top.
- Match the surrounding code's style. Prefer small, focused pull requests.
