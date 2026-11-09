# Contributing to Sevak

Thanks for helping. This guide covers how to get the app running, how changes get reviewed and
shipped, and the security rules everyone follows. The full picture is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Get it running

You need Node 22 and pnpm (`corepack enable` installs pnpm).

```sh
pnpm install
pnpm dev        # the app at http://localhost:3000, with fake demo data
pnpm test       # rules and API tests
pnpm build && DATABASE_URL=postgres://… tests/e2e/run.sh   # whole flows in real browsers (needs a PostgreSQL)
```

No accounts, keys or Docker are needed. Locally the app uses PGlite, a copy of Postgres that runs
inside Node, filled with fake demo data each time it starts.

The clickable prototype (`index.html` and `app/`) has no build step. To preview it on its own:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Making a change

1. **Branch from `staging`** (the default branch). You can't push to `staging` or `main` directly.
2. **Keep it small:** one feature or fix per pull request.
3. **Run `pnpm test`** before you push.
4. **Open a pull request** and fill in the template. Say what changed, why, and how you checked it.
5. **Get a review.** Changes to sensitive areas (database schema, sign-in and permissions, CI and
   deploy settings) need approval from a code owner.
6. **Merge.** Staging (`staging.sevak.theanbgroup.com`) updates a few minutes later, with demo
   data. Check your change there on a phone.
7. **Production** is released by the owner only, from staging, when it's ready.

### Working with Claude

Claude Code reads [`CLAUDE.md`](CLAUDE.md) for the conventions, commands and rules here. In a
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
