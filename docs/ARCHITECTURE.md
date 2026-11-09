# Sevak: Architecture, Delivery and Security

**Status:** Agreed direction for the live app · **Updated:** 2026-11-08

This document describes the long-term architecture for Sevak, how contributors build and ship
changes, how we keep it secure, and what it costs. The requirements it serves are in
[`REQUIREMENTS.md`](REQUIREMENTS.md); IDs such as SGN-5 refer to that document. Diagrams are in
[`DIAGRAMS.md`](DIAGRAMS.md).

**Goals**

1. **One long-term architecture from day one.** The first beta is the first slice of the real
   system, not a throwaway.
2. **Continuous contribution.** Several people, and their Claude sessions, work in one monorepo
   without stepping on each other.
3. **Fast, safe delivery.** Every change is checked automatically, every merge to `staging` is live
   on staging within minutes, and only the owner can release to production.
4. **Security and privacy first.** Volunteers' data is protected by design, not added later.
5. **Cost-conscious.** A known monthly budget (about $10–20), with no per-user fees.

---

## 1. The system

```
Volunteers & hosts (phones first)
        │ HTTPS
        ▼
sevak.theanbgroup.com · staging.sevak.theanbgroup.com
        │
        ▼
Google Cloud project (one for staging, one for production) ───────────────┐
│  Cloud Run service "sevak-web" (Next.js container, scales to zero)      │
│   • Public pages, rendered on the server (SEO, link previews)           │
│   • Host and volunteer screens                                          │
│   • JSON API at /api/v1                                                 │
│  Cloud Run job "sevak-tasks": database migrations before each deploy    │
│  Cloud SQL: PostgreSQL 18 (all data)                                    │
│  Secret Manager: the database connection                                │
│  Artifact Registry: container images                                    │
└─────────────────────────────────────────────────────────────────────────┘
        │                    │                       │
   Resend (email)    Cloudflare R2 (files)    Sentry (errors)
```

One app service and one database per environment. No microservices, no Kubernetes, no servers to
patch. The app is a plain Node container and the database is plain PostgreSQL, so either can move
to another provider (AWS, Neon, Render) by changing configuration, not code.

### 1.1 Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for pages, API and database code (NFR-13) |
| App framework | **Next.js** | Server-rendered public pages (NFR-10), React screens, and the API in one service |
| API | REST + JSON at `/api/v1`, inputs and outputs checked with **Zod** | A future mobile app uses the same API |
| Hosting | **Google Cloud Run** (serverless containers) | Scales to zero, so it costs nearly nothing when idle; Google patches the servers |
| Database | **PostgreSQL 18** on **Cloud SQL** (smallest size to start) | Transactions make "never overbook" reliable (SGN-5); fixed, predictable cost; no per-user fees; portable |
| Database code | **Drizzle ORM**, migrations kept in the repo | Typed queries; every schema change is reviewed like code |
| Local database | **PGlite** (Postgres compiled to run inside Node) | `pnpm dev` and `pnpm test` work on any laptop or Claude session with no Docker and no account |
| Background work | **Cloud Run jobs** (migrations now; reminders and email retries later, on Cloud Scheduler) | Runs only when needed, nothing idle to pay for |
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
├── app/, index.html, …      The clickable prototype, served by the app on staging
├── docs/                    Requirements, architecture, diagrams
├── infra/gcp/               Google Cloud setup script and deploy guide
├── Dockerfile               The app's container image
├── .github/workflows/       CI checks, the Google Cloud deploy, the prototype deploy
├── CLAUDE.md                Instructions every contributor's Claude reads
└── CONTRIBUTING.md          How to contribute
```

The prototype stays where it is, so people working on it are not disrupted. The web app serves a
copy of the prototype's pages during the pilot (see §6), and screens move into proper React
components one at a time after launch.

---

## 2. How contributors work

The flow is the same for a person or for their Claude session:

```
Branch ─► Build and try it locally ─► Pull request ─► CI checks ─► Review ─► Merge ─► Staging ─► (owner) ─► Production
```

1. **Start a branch** from `staging`, the default branch. Never commit to `staging` or `main`
   directly (both are protected, §4.1).
2. **Run it locally.** `pnpm install`, then `pnpm dev`. The app starts with an in-process database
   (PGlite) loaded with fake demo data. No accounts, keys or Docker needed. `pnpm test` runs the
   checks. Claude Code sessions in the cloud get this set up automatically by a start-up hook.
3. **Open a pull request.** Small and focused: one feature or fix.
4. **Automatic checks (CI)** run on every push: type checks, tests, a build, a scan for leaked
   secrets, and a check that database migrations apply cleanly. A pull request can't merge until
   they pass.
5. **Review.** At least one approval, and a code owner's for sensitive areas (§4.1).
6. **Merge → staging.** Merging into `staging` deploys to **staging** (`staging.sevak.theanbgroup.com`)
   within minutes. Try it there on a phone. Staging holds only demo data.
7. **Staging → production, by the owner only.** The owner opens a pull request from `staging` into
   `main`, merges it and approves the deploy. Nobody else can update `main`, and the production
   Google Cloud project only accepts deploys from it. `main` always holds what's live.

Every deploy runs database migrations first, then starts the new version without traffic, checks
its health, and only then switches users to it. A broken version never reaches anyone, and the
previous version can be restored in one click. The full guide is in
[`infra/gcp/README.md`](../infra/gcp/README.md).

**Rapid prototyping** still has a fast lane: the static prototype (`app/`) needs no back end, runs
locally with any static file server, and is served by the app on staging after every merge. Ideas
can be tried there first, then built into the real app.

### Environments

| Environment | Where | Data | Email |
|---|---|---|---|
| Local | Your laptop or Claude session (`pnpm dev`) | Fake demo data in PGlite | Shown in the console |
| Staging | Google Cloud project for staging, from `staging` | Demo data only | Caught, shown in the outbox, never sent |
| Production | Separate Google Cloud project, from `main` | Real data | Sent through Resend |

There are no per-pull-request previews: staging is where changes are tried before production.

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
  once. Only a hash is stored. Requests are rate-limited by email (5 an hour) and, generously, by
  IP (100 an hour, since a whole venue can share one Wi-Fi). Each try is counted before the code
  is checked, in one statement, so guesses sent all at once can't get past the limits: five tries
  and that code stops working, and 30 tries a day for one address stop codes working for it (its
  emailed link still works). The link carries its
  token after `#`, so it never reaches a server log or a link scanner; the sign-in page sends it.
  Links always point at `APP_URL`, never at the request's Host header.
- **Limits** are counted in the database (`rate_limits`, `packages/core/src/limits.ts`), so they
  hold across every server instance. The caller's address is the last one in `X-Forwarded-For`
  that isn't private (Google's front end adds it; earlier entries are whatever the caller sent).
  Besides sign-in: invite-code lookups (30 an hour per address, 20 a day per person), certificate
  checks (60 an hour per address), saves (600 an hour and 50 MB a day per person), organizations
  (10 per person), events (500 per organization), one membership per person and organization, and
  three open certificate requests per person and organization. Invite codes are 8 characters
  from a secure random source; the server refuses shorter new ones.
- **Session:** a random id in a `__Host-` cookie (`Secure; HttpOnly; SameSite=Lax`), stored hashed
  in the database so it can be revoked. Lasts 30 days.
- **Requests that change something** must come from Sevak's own pages (`Sec-Fetch-Site` or
  `Origin`), so another site can't act for a signed-in browser.
- **Continue with Google** (optional, per environment): OpenID Connect with the authorization
  code flow, PKCE, `state` and `nonce`, asking only for `openid email`. The server swaps the code
  for the ID token directly with Google and checks its issuer, audience, expiry and nonce. The
  email must be verified, and must be a Gmail address or a Google Workspace account (`hd`), as
  Google advises; other Google accounts use the emailed code. It signs in to the same account as
  the emailed code. Sevak stores no Google tokens.
- **Shared devices:** everything Sevak keeps in a browser belongs to the person signed in. When
  they sign out, or their session ends, it's all cleared on the next page (including stored
  files), so the next person on the device starts clean (`apps/web/prototype/sync.js`).
- **Pages for running organizations** (Manage, Review, Outbox) send signed-out visitors to sign in.
  The server enforces access either way; this just doesn't show empty previews.
- Code: `packages/core/src/auth.ts` and `google.ts`; routes under `apps/web/src/app/api/v1/auth/`.
- **Manage-my-sign-up links:** long random tokens, stored hashed. A link opens only its own
  sign-up.
- **Platform admins** (Sevak staff, who verify organizations) are listed by email in
  `SEVAK_PLATFORM_ADMINS`. Before production they also use an authenticator app code (TOTP).

### 3.3 Who can see what (§5 of the requirements)

- Every host API call checks the person's role in that organization (Admin or Coordinator) through
  one shared function, and every query on organization data is limited to that organization.
- Public pages show counts ("4 of 6 spots left"), never names. People outside an event's team
  don't see who on the team runs it.
- **Deleted ids stay taken.** Sign-ups, certificates and documents point at organizations and
  events by id, so deleting one keeps a marker (collection `deleted` in `records`) and nobody can
  create a new one with that id. Deleting an organization also deletes its events and
  memberships; sign-ups (with their hours), certificates and documents stay with their people.
- **Certificates say what Sevak knows.** When one is issued, the server sets the organization's
  name and verification, the hours, shifts and events from its own records; the page can't
  choose them. The check page says whether Sevak has verified the organization. Hours for one
  sign-up are at most 24.
- **Verification is redone after a change** to what Sevak checked (name, website, registration
  number, tax status): the organization goes back to pending and staff are asked again.
- **Documents:** the email in `profile:<email>` is lowercased and trimmed, so each person has one
  quota. An Admin can add a certificate's PDF only to someone who asked their organization for
  one, and upload it once. Organizations get 50 MB until verified, then 500 MB.
- Automated tests check these rules on every pull request: for example, a volunteer can't read
  another volunteer's sign-up, and a Coordinator of one organization can't see another's roster.

### 3.4 Time zones (NFR-11)

Each event stores its time zone (for example `America/Chicago`). Shift times are stored in UTC and
shown in the event's time.

### 3.5 Email and calendars (COM-*, COM-10)

**Provider: Resend**, behind one small function (`apps/web/src/lib/mail.ts`), so moving to another
provider means changing that file. Why Resend: its key can only send email, it's free up to 3,000
emails a month (100 a day; $20 a month for 50,000), and it sends from Sevak's own subdomains, so
Sevak's sending reputation is separate from the company's own email. Staging and production are
separate here too: staging sends from `staging.sevak.theanbgroup.com` (subjects start with
"[Staging]") and production from `sevak.theanbgroup.com`, each from its own Resend team and key. Sending through Google
Workspace would need either a key that can send as anyone in the company (domain-wide delegation)
or another licensed mailbox; Amazon SES would need an AWS account. Without a key (local
development, or staging before email is set up) emails, including sign-in codes, are written to
the server log; production refuses to run that way.

**How many:** emails are limited per person whose change causes them (100 an hour, 300 a day;
staff aside), per recipient (20 a day, sign-in emails aside) and per organization (30 a day until
Sevak verifies it, then 1,000). Emails over a limit aren't sent; the change still saves. Names
people typed (organizations, events, volunteers) go in on one line, without control characters,
cut to 80 characters.

**Who decides what's sent:** only the server. Pages never send email (so nobody can use Sevak to
email whoever they like); each change's rules produce the emails it causes
(`packages/core/src/notify.ts`): an invitation, a welcome, a request to join (to the Admins), an
approval or decline, being added to a team, a verification request (to Sevak staff) and its
outcome, a sign-up confirmation (one per sign-up, listing its shifts), a certificate request (to
the Admins), and the certificate issued or declined. The API route sends them after the change is
saved; a failed email is logged and never undoes the change. The prototype's Outbox page is only
used without the server.

Later: the app records each email and queues it in the same transaction as the change that caused it, so
an email is never sent for a sign-up that failed. The background job sends it and retries on
failure. Shift emails carry a calendar invite with a stable id per shift, so a change updates the
volunteer's calendar entry and a cancellation removes it.

---

## 4. Security

### 4.1 The repository and contributors

- **`staging` is protected:** changes arrive only through pull requests, with passing checks and one
  approval. No force-pushes, no deleting the branch.
- **Code owners** (`.github/CODEOWNERS`) must approve changes to sensitive areas: the database
  schema and migrations, sign-in and permissions, CI and deploy settings.
- **Only the owner releases to production:** a ruleset lets only the owner update `main`, and the
  production deploy waits for the owner's approval.
- **Least access:** contributors get *Write* access, not *Admin*. Only the owner (and one backup)
  can change repository settings, Google Cloud or production.
- **Two-factor sign-in** is required for everyone with access, on GitHub and on Google Cloud.
- **Dependencies:** Dependabot opens pull requests for security updates; CI fails on known
  critical vulnerabilities.
- **Secret scanning:** CI scans every pull request for leaked keys (gitleaks).
- **Going private:** the repository can be made private. Things to plan for: rulesets and environment reviewers on a private repository need a paid GitHub plan, and GitHub's
  built-in code scanning is free only for public repositories. The gitleaks and Dependabot checks
  keep working, and the Google side still only accepts production deploys from `main`.

### 4.2 Secrets

- No secrets in the repository, ever. `.env.example` lists names only.
- **No stored keys for deploys.** GitHub Actions signs in to Google Cloud with short-lived
  credentials (Workload Identity Federation). Each Google Cloud project accepts sign-ins only from
  this repository's own branch for that environment.
- The database connection lives in **Secret Manager**. Only the app's own service account can read
  it; GitHub never sees it. For Cloud SQL, the password is generated by the setup script and never
  shown to anyone.
- **Keys for outside services** (Resend, Google sign-in) are entered once as GitHub environment
  secrets, which nobody can read back. Each deploy copies a changed key into that environment's
  Secret Manager and turns off the old copy; the app reads it from there. So a key is changed
  through GitHub, like everything else, and staging's and production's keys stay separate.
- **Staging and production are separate Google Cloud projects.** Staging has no production
  secrets and only demo data. Real data is never copied into staging or onto a laptop.
- The app runs as a non-root user in a minimal container, and has only the permissions it needs.

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
- Data is stored in a **US region** (us-central1) to start; the first organizations are in Texas.
  Organizations in India would later get an India region, in line with India's data protection law
  (DPDP Act 2023).
- Data is encrypted at rest and in transit (the database accepts only encrypted connections).
- Production's database has nightly backups and deletion protection; restoring a backup is tested
  every month.
- An audit log of sensitive actions: who changed roles, approved hours, exported a roster.
- Data export and deletion on request (VOL-6). The privacy policy is updated before the pilot.

---

## 5. Cost

Estimates per month. Check current prices before committing.

| Item | Service | Cost |
|---|---|---|
| Database | Cloud SQL PostgreSQL, smallest size (`db-f1-micro`, 10 GB) | **About $9–10 per environment** |
| App and migration jobs | Cloud Run | **Usually $0** within the free tier at this size |
| Images, secrets | Artifact Registry (recent images only), Secret Manager | **Under $1** |
| Email | Resend free tier to start | **$0**, then about $20 |
| Files, errors | Cloudflare R2 and Sentry free tiers | **$0** |
| Code and CI | GitHub Free (public) | **$0**; a private repository with rulesets needs a paid plan, about $4 per person |
| **Total** | | **About $10 for staging, about $20 with production** |

Google Cloud's $300 free trial covers this at first; a Google for Startups application is in
progress. Each project has a **budget alert** that counts real usage even while credits pay for
it. Staging's database can be stopped when nobody is testing, to save most of its cost.

---

## 6. First pilot: January 2027

Two organizations in Houston (a temple and a cultural center) plan to start using Sevak in
January 2027. The Flute Mali Centenary Celebration on November 14, 2026 uses a Google Form for
volunteers, and the real app is built properly for the pilot.

**Approach:** staging goes live first, so the team can use real shared data early, and features
arrive about weekly. Production goes live once the owner approves it.

| When | Milestone |
|---|---|
| Week of Nov 9 | Staging live on Google Cloud (Cloud Run + Cloud SQL) with the foundation |
| Nov–Dec, about weekly | Sign-in; organization and event editing on the database; volunteer sign-up with emails and calendar invites; roster and check-in; hours approval; certificates |
| Mid-December | Production project set up; privacy policy updated; dry run with the pilot organizations |
| **January 2027** | **Pilot starts** on `sevak.theanbgroup.com` |

**How the app reuses the prototype:** the web app serves the prototype's pages with one script
added to the top of each, `apps/web/prototype/sync.js`. The pages still read and write browser
storage; sync.js loads chosen keys from the server before the page starts (`GET /api/v1/sync`)
and sends each change back (`POST /api/v1/sync/<key>`). The server keeps them in the `records`
table and decides who may see and change each one (`packages/core/src/records.ts`): a change that
isn't allowed is refused and the page gets the server's copy back. That keeps the screens people
have already reviewed, and they move into React components and proper tables one at a time.

| Data | On the server since | Who sees it | Who changes it |
|---|---|---|---|
| Profile (`sevak.profile.v1`) | Sign-in release | You | You |
| Organizations (`sevak.organizations.v1`) | Sign-in release | Everyone: name, description, website, city, charity status, verification. Its team and Sevak staff: everything | Admins; Coordinators can only leave the team; only Sevak staff verify |
| Memberships (`sevak.memberships.v1`): who volunteers with which organization | Join release | You: your own. The organization's team and Sevak staff: theirs | You: ask to join, accept an invitation, leave. The team: approve, decline, invite, remove. Joining with an invite code goes through the server, which checks the code |
| Events and main events (`sevak.events.v1`, `sevak.mainEvents.v1`) | Events release | The team: all of its events. Its volunteers: published, active ones (public or private). Everyone else: published, active, public events of verified organizations | The team adds and edits; only Admins delete |
| Sign-ups, check-ins and hours (`sevak.signups.v1`) | Sign-ups release | You: your own. The event's team: its sign-ups (the roster). Everyone else: only that a spot is taken, never names | You sign up yourself (volunteers and the team only, published events), cancel, check in and out, and log hours, which always wait for approval. The team approves hours and manages its roster. The server checks capacity with the event locked, so a shift is never overbooked (SGN-5) |
| Certificates and signatures (`sevak.certificates.v1`, `sevak.signatures.v1`) | Certificates release | You: your requests and certificates, your own signature. The organization's team: its organization's | You ask for one or withdraw your request. Only Admins issue or decline; the hours must equal the approved hours on record; numbers are unique; issued certificates can't change. Anyone checks one by number (`/api/v1/certificates/verify/{code}`), which shows only what proves it |
| Documents (`sevak.documents.v1`) and their files | Certificates release | Your own; an organization's and its events' documents: its team | The same people; Admins add certificates they issue to the volunteer's documents. Files go in a private Cloud Storage bucket per environment and are served only through `/api/v1/files/{id}` after the same check, always as downloads. 10 MB a file; 100 MB per person, 500 MB per organization; PDFs, pictures, Office and text files only, checked by content |

Demo data (ids starting `demo-`) stays in each browser.

### Domains

- `staging.sevak.theanbgroup.com`: staging, on Google Cloud (set up in
  [`infra/gcp/README.md`](../infra/gcp/README.md)).
- `sevak.theanbgroup.com` still shows the last prototype published on GitHub Pages (Pages is no
  longer deployed). At launch, Pages is turned off and the address moves to production on Google
  Cloud. The prototype stays reachable on staging for design reviews.
