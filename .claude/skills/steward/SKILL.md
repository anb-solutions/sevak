---
name: steward
description: Sevak's checklist for anyone (person or AI) pushing, opening, reviewing or merging a pull request. Read it before every push and every merge, and always before merging your own pull request. It says what must be checked, what to try to break, and which changes need the owner.
---

# Shipping a change to Sevak

Sevak handles real people's names, emails, phones and volunteer hours. **A merge into `staging`
is a release:** it deploys within minutes, and pilot organizations use staging. Treat every
merge the way you'd treat shipping to production. `CLAUDE.md` has the conventions; this is the
checklist that goes with them.

## 1. Before you push

Run these yourself and say in the pull request what you ran. Never skip, disable, loosen or
"update to pass" a test to get green.

```sh
pnpm typecheck && pnpm test            # rules and API tests
tests/run.sh /tmp/shots                # the pages, in a browser (390px wide)
pnpm build && DATABASE_URL=postgres://… tests/e2e/run.sh   # whole flows, real server and PostgreSQL
```

- **Re-run the end-to-end tests on a fresh database.** Limits are kept in the database, so a
  second run within the hour can hit the sign-in limit and fail for that reason alone.
- **New flow, new end-to-end check.** A new rule gets a test that someone without access is
  refused.
- **Branch from the latest `staging`** and bring it in again just before merging. Other people,
  and their AIs, merge too.

## 2. What to look for (and try to break)

Read the diff as an attacker would. These are the mistakes this codebase has actually had.

**Who may do it: the server decides, never the page.**
- Every write goes through the rules in `packages/core` (`records.ts`, `memberships.ts`,
  `events.ts`, `signups.ts`, `certificates.ts`, `documents.ts`). A check that exists only in
  `app/*.js` isn't a check: anyone can call the API directly.
- New API route:
  - `fromOurPages(req)` for anything that changes data
  - `viewerFor(req)` and a role check
  - Zod for every input
  - a test that a signed-out person, someone outside the organization and a Coordinator (where
    relevant) are refused
- Fields only the server sets stay the server's: verification status, stored file details,
  certificate facts, decisions on hours. Check that a page can't send them and have them kept.

**Who may see it (requirements §5).**
- **Volunteers and the public:** see only their own details, and counts. Never anyone else's
  name, email or phone.
- **Admins:** see their organization's volunteers.
- **Coordinators:** see only the roster of events they're the **event admin** of (`runsEvent`).
  Not memberships, join requests or certificates.
- `packages/core/src/visibility.test.ts` records exactly what ten kinds of person receive. **If
  your change alters that snapshot, it changes who sees what.** Don't run `vitest -u` to make it
  pass. Explain the difference in the pull request; it needs the owner's approval.

**Nobody approves themselves.**
- Nobody decides on their own hours. An Admin's hours need a different Admin, or Sevak staff.
- Nobody issues or declines their own certificate. An Admin's needs a different Admin, or Sevak
  staff (`own_certificate` in `certificates.ts`).
- Known limit for both: someone who adds a second email address of their own to the team can act
  through it. Only a person reviewing the Team tab can catch that.
- Certificates take the organization, hours and events from Sevak's records, never from the
  page.
- Look for indirect routes:
  - creating a new record that's already "approved"
  - moving a record to another person and back
  - reusing a deleted id (deleted organizations and events stay buried)

**Abuse and cost.**
- Anything that sends email goes through `packages/core/src/notify.ts` and the limits in
  `limits.ts`. Pages never send email. Names typed by people go into emails through `clean()`.
- Anything someone can repeat (sign-in, guessing codes, saving, uploading) is limited in the
  database (`hit()` in `limits.ts`), not in memory, and per person as well as per address.
- Reads ask the database only for rows the person may see (`readContext`). Never load a whole
  collection on a page load.

**Pages.**
- **No inline scripts:** the content security policy is `script-src 'self'`.
- Text from people goes in with `textContent`, never `innerHTML`.
- Links people supplied are shown only if they're `https:`, and open with
  `rel="noopener noreferrer"`.
- Check at 390px wide, with labels and keyboard use.

**Files.** Uploads are checked by their content, not their name. They're served only as
downloads, only to people who may see them, within the size and space limits.

**Secrets and data.**
- No keys, passwords or tokens in code, tests, logs or GitHub *variables*. Keys are GitHub
  environment *secrets*, which the deploy copies to Secret Manager.
- Never replace `app-secrets-key`: every organization's Zeffy connection would stop working.
- No real personal data in tests, fixtures or screenshots. Use `example.com` addresses. Don't
  name pilot organizations anywhere public.
- Never use production data anywhere else.

**Database.**
- Change `packages/db/src/schema.ts`, run `pnpm db:generate`, and commit both.
- Migrations only add. Remove things in a later release, so the version still running keeps
  working. Never edit a merged migration.

**Infrastructure.**
- **Staging and production are identical.** The only differences are staging's labels and the
  owner's approval for production. Don't add a setting to one only.
- Anything that needs a Google Cloud Owner goes in `infra/gcp/setup.sh` (safe to run again) and
  `docs/ENVIRONMENTS.md`.
- **The deploy account stays least-privilege.** Never give it more roles to make something easier.

**Docs.**
- Update `docs/REQUIREMENTS.md`: the requirement's ID, and the version line, taking the next
  number after **staging's current** one.
- Update `docs/ARCHITECTURE.md` and `docs/ENVIRONMENTS.md` when they change.

## 3. Changes that need the owner

Don't merge these yourself, even with green CI. Ask the code owner (see `.github/CODEOWNERS`):

- who can see or change what: the access rules in `packages/core`, or the `visibility.test.ts`
  snapshot
- sign-in and sessions: `auth.ts`, `google.ts`, `apps/web/src/lib/http.ts`, cookies, limits
- the database schema or migrations
- `.github/`, `infra/`, `Dockerfile`, Google Cloud permissions, or anything deploying to
  production
- anything that sends email to new kinds of people, or stores a new kind of personal data
- adding a dependency

**Production is released by the owner only.** Never push to, open a pull request into, or merge
into `main`.

## 4. Merging (your own pull request too)

Merge only when **all** of these hold:

- [ ] All five CI checks are green on the **latest** commit: typecheck/test/build, browser tests,
      migrations, container image, secret scan.
- [ ] It's up to date with `staging`, with no conflicts. Re-run the checks after bringing
      `staging` in.
- [ ] Nothing in §3, or the owner has approved it.
- [ ] The pull request says honestly what changed, why, and what you ran. Unticked boxes say why.
- [ ] You re-read your own diff against §2.

After merging:
- Watch the **Deploy** run in GitHub Actions until it succeeds.
- Check `https://staging.sevak.theanbgroup.com/api/v1/health` answers `{"ok":true}`.
- If the deploy fails, users stay on the previous version. Fix it, or revert with a new pull
  request. Never force-push or rewrite history on `staging`.

## 5. Reviewing someone else's pull request

- Read the whole diff, not just the description.
- For each new rule, try to get around it the ways in §2 (directly through the API, by indirect
  steps, as a Coordinator, as an outsider), and check there's a test that does the same.
- Report what you tried and what held, not only what's wrong.
- **Blocking:** security, privacy, data loss, a failing or skipped test.
- **Not blocking:** small things (style, wording); say so.
