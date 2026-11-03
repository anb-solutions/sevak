# Sevak: Architecture, Delivery and Security

**Status:** Agreed direction for the live app · **Updated:** 2026-11-03

This document describes the long-term architecture for Sevak, how contributors build and ship
changes, how we keep it secure, and what it costs. The requirements it serves are in
[`REQUIREMENTS.md`](REQUIREMENTS.md); IDs such as SGN-5 refer to that document. Diagrams are in
[`DIAGRAMS.md`](DIAGRAMS.md).

**Goals**

1. **One long-term architecture from day one.** The first beta is the first slice of the real
   system, not a throwaway.
2. **Continuous contribution.** Several people, and their Claude sessions, work in one monorepo
   without stepping on each other.
3. **Fast, safe delivery.** Every change is checked automatically, every pull request gets a live
   preview, and a merge to `main` is live within minutes.
4. **Security and privacy first.** Volunteers' data is protected by design, not added later.
5. **Cost-conscious.** A known monthly budget, with no per-user fees.

---

## 1. The system

```
Volunteers & hosts (phones first)
        │ HTTPS
        ▼
Cloudflare: DNS, TLS, caching, bot protection (Turnstile)
        │
        ▼
Railway project ──────────────────────────────────────────────────────────┐
│  App service (Next.js, TypeScript)                                       │
│   • Public pages, rendered on the server (SEO, link previews)            │
│   • Host and volunteer screens                                           │
│   • JSON API at /api/v1                                                  │
│   • Background jobs (pg-boss): emails, reminders, certificates           │
│                                                                          │
│  PostgreSQL: all data, plus the job queue                                │
└──────────────────────────────────────────────────────────────────────────┘
        │                    │                       │
   Resend (email)    Cloudflare R2 (files)    Sentry (errors)
```

One app service and one database. No microservices, no Kubernetes. Everything is plain Node and
plain Postgres, so it can move to another host (Render, Fly.io, AWS, Google Cloud) by changing
configuration, not code.

### 1.1 Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for pages, API and database code (NFR-13) |
| App framework | **Next.js** | Server-rendered public pages (NFR-10), React screens, and the API in one service |
| API | REST + JSON at `/api/v1`, inputs and outputs checked with **Zod** | A future mobile app uses the same API |
| Database | **PostgreSQL** on Railway | Transactions make "never overbook" reliable (SGN-5); no per-user fees; portable |
| Database code | **Drizzle ORM**, migrations kept in the repo | Typed queries; every schema change is reviewed like code |
| Local database | **PGlite** (Postgres compiled to run inside Node) | `pnpm dev` and `pnpm test` work on any laptop or Claude session with no Docker and no account |
| Background jobs | **pg-boss** (a queue stored in Postgres) | Retries and scheduled reminders without Redis |
| Sign-in | Our own email **link and 6-digit code**; sessions stored in Postgres | No vendor lock-in; the code also works in the iPhone home-screen app |
| Email | **Resend** to start; Amazon SES if volume makes it cheaper | Every shift email carries a calendar invite (COM-10) |
| Files | **Cloudflare R2** | Documents, photos, certificate PDFs; no download fees |
| Errors | **Sentry** (free tier) | Alerts when something breaks |
| Tests | **Vitest** (logic and database, on PGlite) + **Playwright** (phone-sized browser tests) | Covers sign-up, capacity, attendance and privacy rules |

### 1.2 Repository layout (monorepo, pnpm workspaces)

```
sevak/
├── apps/
│   └── web/                 Next.js: pages, /api/v1, background jobs
├── packages/
│   ├── db/                  Drizzle schema, migrations, seed and demo data
│   └── core/                Rules in plain TypeScript: sign-up and capacity,
│                            permissions, hours, certificates. No web code.
├── app/, index.html, …      The clickable prototype, still published to GitHub Pages
├── docs/                    Requirements, architecture, diagrams
├── .github/workflows/       CI checks and the prototype deploy
├── CLAUDE.md                Instructions every contributor's Claude reads
└── CONTRIBUTING.md          How to contribute
```

The prototype stays where it is, so people working on it are not disrupted. The web app serves a
copy of the prototype's pages during the beta (see §6), and screens move into proper React
components one at a time after launch.

---

## 2. How contributors work

The flow is the same for a person or for their Claude session:

```
Branch ─► Build and try it locally ─► Pull request ─► CI checks + live preview ─► Review ─► Merge ─► Live
```

1. **Start a branch** from `main`. Never commit to `main` directly (it's protected, §4.1).
2. **Run it locally.** `pnpm install`, then `pnpm dev`. The app starts with an in-process database
   (PGlite) loaded with fake demo data. No accounts, keys or Docker needed. `pnpm test` runs the
   checks. Claude Code sessions in the cloud get this set up automatically by a start-up hook.
3. **Open a pull request.** Small and focused: one feature or fix.
4. **Automatic checks (CI)** run on every push: type checks, tests, a build, a scan for leaked
   secrets, and a check that database migrations apply cleanly. A pull request can't merge until
   they pass.
5. **Live preview.** Railway builds a **temporary copy of the whole app for the pull request**,
   with its own database of fake demo data, and posts the link on the pull request. Anyone can try
   the change on a phone before it merges. Previews never see real data or real secrets, and
   emails there are caught and shown in an on-screen outbox instead of being sent. The preview is
   deleted when the pull request closes. This also works for pull requests opened by Claude Code.
6. **Review.** At least one approval from a code owner (§4.1).
7. **Merge.** Railway deploys `main` to production once CI has passed, usually within a few minutes.
   Database migrations run first. A bad deploy is rolled back in one click in Railway.

**Rapid prototyping** still has a fast lane: the static prototype (`app/`) keeps deploying to
GitHub Pages on every merge, and needs no back end. Ideas can be tried there first, then built into
the real app.

### Environments

| Environment | Where | Data | Email |
|---|---|---|---|
| Local | Your laptop or Claude session (`pnpm dev`) | Fake demo data in PGlite | Shown in the console |
| Preview | Railway, one per pull request | Fake demo data | Caught, shown in the outbox, never sent |
| Production | Railway, `sevak.theanbgroup.com` | Real data | Sent through Resend |

There's no separate staging environment at first: previews do that job. We'll add one when there
are more contributors.

---

## 3. Key design details

### 3.1 Capacity checks that never overbook (SGN-5)

Each shift keeps a `filled` count. A sign-up takes a spot with one statement that only succeeds if
a spot is left, inside the same transaction that saves the sign-up:

```sql
UPDATE shifts SET filled = filled + 1
 WHERE id = $1 AND filled < capacity
RETURNING id;
```

No row back means the shift is full, and the whole form is rolled back with a clear message. A
cancellation gives the spot back in the same transaction. A database rule
(`CHECK (filled <= capacity)`) is the final safety net.

### 3.2 Sign-in and secure links (VOL-1, NFR-4, NFR-6)

- **Sign-in:** the email contains a link and a 6-digit code. Both expire after 15 minutes and work
  once. Only a hash is stored. Requests are rate-limited by email and by IP.
- **Session:** a random id in a `Secure; HttpOnly; SameSite=Lax` cookie, stored in the database so
  it can be revoked. Lasts 30 days.
- **Manage-my-sign-up links:** long random tokens, stored hashed. A link opens only its own
  sign-up.
- **Platform admins** also use an authenticator app code (TOTP).

### 3.3 Who can see what (§5 of the requirements)

- Every host API call checks the person's role in that organization (Admin or Coordinator) through
  one shared function, and every query on organization data is limited to that organization.
- Public pages show counts ("4 of 6 spots left"), never names.
- Automated tests check these rules on every pull request: for example, a volunteer can't read
  another volunteer's sign-up, and a Coordinator of one organization can't see another's roster.

### 3.4 Time zones (NFR-11)

Each event stores its time zone (for example `America/Chicago`). Shift times are stored in UTC and
shown in the event's time.

### 3.5 Email and calendars (COM-*, COM-10)

The app records each email and queues it in the same transaction as the change that caused it, so
an email is never sent for a sign-up that failed. The background job sends it and retries on
failure. Shift emails carry a calendar invite with a stable id per shift, so a change updates the
volunteer's calendar entry and a cancellation removes it.

---

## 4. Security

### 4.1 The repository and contributors

- **`main` is protected:** changes arrive only through pull requests, with passing checks and one
  approval. No force-pushes, no deleting the branch.
- **Code owners** (`.github/CODEOWNERS`) must approve changes to sensitive areas: the database
  schema and migrations, sign-in and permissions, CI and deploy settings.
- **Least access:** contributors get *Write* access, not *Admin*. Only the owner (and one backup)
  can change repository settings or production.
- **Two-factor sign-in** is required for everyone with access, on GitHub and on Railway.
- **Dependencies:** Dependabot opens pull requests for security updates; CI fails on known
  critical vulnerabilities.
- **Secret scanning:** CI scans every pull request for leaked keys (gitleaks).
- **Going private:** the repository can be made private once the app is hosted on Railway. Two
  things to plan for: GitHub Pages for a private repository needs a paid GitHub plan (or the
  prototype moves into the app), and GitHub's built-in code scanning is free only for public
  repositories. The gitleaks and Dependabot checks above keep working either way.

### 4.2 Secrets

- No secrets in the repository, ever. `.env.example` lists names only.
- Production secrets live in Railway's production environment, visible only to the owner and the
  backup.
- **Previews get no production secrets and no real data.** They run with a test email setting that
  sends nothing, and their own database of fake demo data. Real data is never copied into a
  preview or onto a laptop.

### 4.3 The app

- HTTPS everywhere, strict security headers (including a Content Security Policy).
- Every input is checked on the server (Zod), whatever the page already checked.
- Cloudflare Turnstile and rate limits on public forms (SGN-8).
- Protection against cross-site request forgery: `SameSite` cookies plus an origin check on every
  change.
- "Fill in from website" (ORG-10) runs on the server with protections against requests to internal
  addresses.

### 4.4 Data and privacy

- Collect as little as possible. No date of birth (NFR-8). Phone is optional.
- Organizations see a volunteer's details only for their own events.
- Data is stored in a **US region** to start (the first events are in Texas). Organizations in
  India would later get an India region, in line with India's data protection law (DPDP Act 2023).
- Nightly encrypted database backups to R2, and a test restore every month.
- An audit log of sensitive actions: who changed roles, approved hours, exported a roster.
- Data export and deletion on request (VOL-6). The privacy policy is updated before the beta.

---

## 5. Cost

Estimates per month. Check current prices before committing.

| Item | Service | Cost |
|---|---|---|
| App, database and previews | Railway **Hobby** plan (one owner) | **$5–15** (the $5 plan includes $5 of usage) |
| | Railway **Pro** plan (if several people need the Railway dashboard) | **$20–30** |
| Email | Resend free tier to start | **$0**, then about $20 |
| DNS, TLS, bot protection, files | Cloudflare (free) and R2 (free at this size) | **$0** |
| Errors | Sentry free tier | **$0** |
| Code and CI | GitHub Free (public) | **$0**; private with Pages: about $4 per person on GitHub Pro or Team |
| **Total** | | **about $5–15** on Hobby; **$25–50** with a team plan and paid email |

Previews cost a little while a pull request is open and nothing once it closes. Railway's
"focused" previews only rebuild what changed, which keeps them cheap. Set a **spending limit** in
Railway so a bug can't run up a bill.

---

## 6. First beta: Flute Mali Centenary Celebration (Sat, Nov 14, 2026)

The first real event: volunteers sign up on their phones, and the host team checks them in on the
day.

| | |
|---|---|
| Event | Flute Mali Centenary Celebration, hosted by Roopa Arts Cultural Center |
| When | Saturday, November 14, 2026, 10:00 AM – 1:00 PM Central |
| Where | Sugar Land, TX (venue shared by email with registrants) |
| Public RSVP | Zeffy (stays as is); Sevak handles **volunteers** only |

**In the beta:** the organization and event (loaded by us, with the exact wording from Zeffy);
volunteer sign-up on phones with live spots-left; confirmation email with Google Calendar and
.ics; email sign-in; My sign-ups and cancel; host roster, check-in and hours; CSV export.

**After the beta:** organization and event editors on the live database, public discovery, search
listing, reminders, certificate PDFs, documents and photos, corporate features.

**How the beta reuses the prototype:** the web app serves the prototype's pages, and the
prototype's storage files (`orgs-store.js`, `events-store.js`, `signups-store.js` and the ones the
roster uses) get a version that talks to `/api/v1` instead of the browser. That keeps the screens
people have already reviewed, and is replaced screen by screen with React after launch.

| Date | Milestone |
|---|---|
| Tue, Nov 3 | Plan agreed; repo foundation, database schema, CI |
| Wed, Nov 4 | Sign-up API with capacity checks; volunteer pages on the API |
| Thu, Nov 5 | Email sign-in; host roster, check-in and hours |
| Fri, Nov 6 | Emails with calendar invites; CSV; privacy tests; first Railway deploy |
| Sat–Sun, Nov 7–8 | Phone testing; dry run with 3–5 volunteers |
| Mon, Nov 9 | Fixes, then freeze |
| **Tue, Nov 10** | **Volunteer sign-up opens** (shared on WhatsApp) |
| **Sat, Nov 14** | **Event day:** check-in from phones |
| After | Export hours; thank-you emails; review what to keep, fix and build next |

**Fallback:** if the beta isn't solid by Sunday, Nov 8, volunteers for this event sign up through a
Google Form, and the build carries on for the next event.

### Domains

- `sevak.theanbgroup.com` points at the prototype on GitHub Pages today. On launch day it moves to
  Railway (the live app).
- The prototype then moves to its own address, for example `prototype.sevak.theanbgroup.com`, so
  design reviews carry on.
