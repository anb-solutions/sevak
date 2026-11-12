# Sevak

*A Service of The ANB Group.*

A web app for organizations to publish volunteer events and shifts, and for volunteers to sign up
in seconds.

**Status:** beta on staging (`staging.sevak.theanbgroup.com`), ahead of the first pilot in January
2027. `sevak.theanbgroup.com` still shows the last prototype published to GitHub Pages until
production launches there.

## How it's built

- [`apps/web`](apps/web): the Next.js app. It serves the prototype's pages (below) and the
  `/api/v1` API: sign-in with an emailed code or Google, a sync API that keeps the pages' data on
  the server, certificate checks, files, joining by invite code and the Zeffy import. It sends
  real email (invitations, approvals, sign-up confirmations, certificates and more).
- [`packages/core`](packages/core): the rules in plain TypeScript: who sees and changes what,
  sign-up and capacity, certificates, emails, time zones, tokens.
- [`packages/db`](packages/db): the PostgreSQL schema (Drizzle) and its migrations.
- [`index.html`](index.html) and [`app/`](app/): the pages, plain HTML, CSS and JavaScript with no
  build step. On their own they keep everything in the browser; in the app, `sync.js` keeps their
  data on the server.

Hosting is Google Cloud (Cloud Run, Cloud SQL PostgreSQL, Cloud Storage). Every merge into
`staging` deploys to staging; the owner releases to production by merging `staging` into `main`.
Guide: [`infra/gcp/README.md`](infra/gcp/README.md). Settings for each environment:
[`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md).

## Run it

```sh
corepack enable && pnpm install
pnpm dev     # http://localhost:3000 with an in-memory database, emptied on every restart
pnpm test
```

No accounts, keys or Docker needed. Sign-in codes are printed in the terminal instead of emailed.
How to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md).

To try the pages alone, with made-up data in your browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/app/dashboard.html?demo=1
```

`?demo=1` (or **Load demo data** on the Dashboard) adds *Riverside Community Arts*, with main
events, sub-events, tasks, shifts, sign-ups, volunteers, requests to join and an invitation, and
*Eastside Food Pantry*. If you're signed in, you're added to Riverside's team as an Admin. Invite
codes **RIVER7** and **PANTRY** work on the Join page. **Remove demo data** clears it. The app
itself never offers demo data.

## Pages

| Page | What it's for |
| --- | --- |
| [`join.html`](app/join.html) | Join as a volunteer, with an invitation (link or code) or by asking to join |
| [`signin.html`](app/signin.html) | Sign in. In the app: an emailed code or Google; alone: the profile saved in this browser |
| [`profile.html`](app/profile.html) | Your profile, organizations and documents |
| [`signup.html`](app/signup.html) | Volunteer side: opportunities (My organizations, All organizations), signing up, **My sign-ups** (check in, log hours, request certificates), tasks you lead |
| [`dashboard.html`](app/dashboard.html) | Upcoming events and volunteers needed against signed up |
| [`events.html`](app/events.html) | An organization's events, main events and their sub-events, each with an Edit button |
| [`main-event.html`](app/main-event.html) | A main event and its sub-events, such as a festival and its rehearsals |
| [`event.html`](app/event.html) | Create or edit an event in four steps: details, when and where, tasks (shifts and task leads), review |
| [`volunteers.html`](app/volunteers.html) | Requests to join, invitations, members, hours to approve, certificates to issue |
| [`organization.html`](app/organization.html) | The organization's profile, team, documents and verification request |
| [`certificate.html`](app/certificate.html) | A volunteer's certificate (view, PDF, print), or a preview before it's issued |
| [`verify.html`](app/verify.html) | Check a certificate is genuine from its number |
| [`review.html`](app/review.html) | Sevak staff review organizations' verification requests |
| [`outbox.html`](app/outbox.html) | Alone: every email Sevak would send. In the app, email is sent for real |

## Tests

```sh
tests/run.sh /tmp/sevak-shots              # the pages in a real browser (Playwright), with screenshots
pnpm build && DATABASE_URL=postgres://… tests/e2e/run.sh   # whole flows against the app and PostgreSQL
```

CI runs both on every pull request, with typecheck, unit tests, the build, migrations on
PostgreSQL 18, the container image and a secret scan.

## Documents

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md): what to build, with requirement IDs
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how it's built and hosted
- [`docs/DIAGRAMS.md`](docs/DIAGRAMS.md): UML diagrams of the current build
- [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md): every setting and secret an environment needs
