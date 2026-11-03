# Contributing to Sevak

Thanks for helping. This guide covers how to get the app running, how changes get reviewed and
shipped, and the security rules everyone follows. The full picture is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Get it running

You need Node 22 and pnpm (`corepack enable` installs pnpm).

```sh
pnpm install
pnpm dev        # the app at http://localhost:3000, with fake demo data
pnpm test       # all checks
```

No accounts, keys or Docker are needed. Locally the app uses PGlite, a copy of Postgres that runs
inside Node, filled with fake demo data each time it starts.

The clickable prototype (`index.html` and `app/`) has no build step. To preview it on its own:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Making a change

1. **Branch from `main`.** You can't push to `main` directly.
2. **Keep it small:** one feature or fix per pull request.
3. **Run `pnpm test`** before you push.
4. **Open a pull request** and fill in the template. Say what changed, why, and how you checked it.
5. **Try the preview.** A live copy of the app for your pull request is built automatically, with
   fake data, and its link appears on the pull request. Check it on a phone.
6. **Get a review.** Changes to sensitive areas (database schema, sign-in and permissions, CI and
   deploy settings) need approval from a code owner.
7. **Merge.** Production updates automatically a few minutes later.

### Working with Claude

Claude Code reads [`CLAUDE.md`](CLAUDE.md) for the conventions, commands and rules here. In a
Claude Code cloud session the dependencies are installed automatically, so Claude can run the app
and the tests. Review what Claude changes the same way you'd review anyone's work.

## Database changes

- Change the schema in `packages/db/src/schema.ts`, then run `pnpm db:generate` to create a
  migration. Commit both.
- Migrations must work while the previous version of the app is still running: add things first,
  remove them in a later release.
- Never edit a migration that has already been merged.

## Security rules

- **Never commit secrets** (keys, passwords, tokens) or real people's data. Use `.env.local`, which
  is ignored by git. CI scans every pull request for leaked secrets.
- **Never copy production data** to your laptop, a Claude session or a preview. Use the demo data.
- **Check permissions on the server.** Every API route that reads or changes organization data
  must check the person's role. Add a test that someone without access is refused.
- **Check inputs on the server** with Zod, even if the page already checks them.
- Turn on two-factor sign-in for your GitHub account.
- Found a security problem? Tell the maintainers privately, not in a public issue.
