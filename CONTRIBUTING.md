# Contributing to Sevak

Thanks for helping. This guide covers how to get the app running, how changes get reviewed and
shipped, and the security rules everyone follows. The full picture is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Get it running

You need Node 22 and pnpm (`corepack enable` installs pnpm).

```sh
pnpm install
pnpm dev        # the app at http://localhost:3000
pnpm typecheck
pnpm test       # rules and API tests
tests/run.sh /tmp/sevak-shots                              # the pages in a real browser (Playwright)
pnpm build && DATABASE_URL=postgres://… tests/e2e/run.sh   # whole flows in real browsers (needs a PostgreSQL)
```

No accounts, keys or Docker are needed. Locally the app uses PGlite, a copy of Postgres that runs
inside Node, emptied each time it starts; sign-in codes are printed in the terminal.

The pages (`index.html` and `app/`) have no build step. To try them on their own, with made-up
data kept in your browser:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/app/dashboard.html?demo=1
```

## Making a change

1. **Branch from `staging`** (the default branch). You can't push to `staging` or `main` directly.
2. **Keep it small:** one feature or fix per pull request.
3. **Run the checks** before you push: `pnpm typecheck`, `pnpm test`, `tests/run.sh`, and
   `pnpm build` with `tests/e2e/run.sh` on a fresh database. Check pages at 390px wide. Add an
   end-to-end test for each new flow.
4. **Open a pull request** and fill in the template. Say what changed, why, and how you checked it.
5. **Get a review.** Changes listed under "Changes that need the owner" in the checklist (who sees
   what, sign-in and sessions, the database schema, `.github/`, `infra/`, the `Dockerfile`, Google
   Cloud permissions, new kinds of personal data or email, new dependencies) need the owner's
   approval.
6. **Merge.** Staging (`staging.sevak.theanbgroup.com`) updates a few minutes later. People use
   it, so a merge is a release: follow the checklist in
   [`.claude/skills/steward/SKILL.md`](.claude/skills/steward/SKILL.md) first, especially if you
   merge your own pull request. There are no preview deployments, so check your change there on a
   phone after it merges.
7. **Production** is released by the owner only, from staging, when it's ready.

### Working with Claude

Claude Code reads [`CLAUDE.md`](CLAUDE.md) for the conventions, commands and rules here, and
the checklist in [`.claude/skills/steward/SKILL.md`](.claude/skills/steward/SKILL.md) before
pushing or merging. Other AI tools are pointed to both by [`AGENTS.md`](AGENTS.md). In a
Claude Code cloud session the dependencies are installed automatically, so Claude can run the app
and the tests. Review what Claude changes the same way you'd review anyone's work.

## Database changes

Schema changes go through GitHub like any other change:

1. Change the schema in `packages/db/src/schema.ts`, then run `pnpm db:generate` to create a
   migration. Commit both.
2. **Pull request:** CI checks the migration matches the schema, runs the tests, and applies every
   migration to a real PostgreSQL 18 (the same version as Cloud SQL).
3. **Merge into `staging`:** the deploy runs the migration on staging's database **before** the new
   version gets any users, then checks the new version can read the database. If either fails,
   users stay on the previous version.
4. **Release to production** (the owner merges `staging` into `main`): the same migration runs on
   production's database.

Rules:

- Migrations must work while the previous version of the app is still running: add things first,
  remove them in a later release. Never rename or drop something the running version still uses.
- Never edit a migration that has already been merged.

## Security rules

- **Never commit secrets** (keys, passwords, tokens) or real people's data. Use `.env.local`, which
  is ignored by git. CI scans every pull request for leaked secrets.
- **Never copy production data** to your laptop, a Claude session or staging. Use the demo data.
- **Check permissions on the server.** Every API route that reads or changes organization data
  must check the person's role. Add a test that someone without access is refused.
- **Check inputs on the server** with Zod, even if the page already checks them.
- Turn on two-factor sign-in for your GitHub account.
- Found a security problem? Tell the maintainers privately, not in a public issue.
