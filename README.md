# Sevak

*A Service of The ANB Group.*

A simple web app for organizations to publish volunteer events and shifts, and for volunteers to
sign up in seconds.

**Status:** pre-MVP. The clickable prototype is live; the real app (database, API, sign-in) is being
built for its first beta event on November 14, 2026.

## The live app (in progress)

A monorepo: [`apps/web`](apps/web) (Next.js: pages and the `/api/v1` API), [`packages/db`](packages/db)
(PostgreSQL schema and migrations) and [`packages/core`](packages/core) (rules such as "never
overbook a shift"). It's hosted on Railway, with a live preview for every pull request.

```sh
corepack enable && pnpm install
pnpm dev     # http://localhost:3000, with an in-memory database and demo data
pnpm test
```

No accounts or Docker needed. How to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Documents and the prototype


- MVP requirements: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- Architecture, back end and hosting plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- UML diagrams for discussion (use cases, data model, event and sign-up lifecycles, key flows, system): [`docs/DIAGRAMS.md`](docs/DIAGRAMS.md)
- Landing page: [`index.html`](index.html) (static, no build step)
- Front-end prototype: [`app/`](app/). It uses mock data stored in your browser, with no backend yet.
  - [`app/join.html`](app/join.html): join Sevak as a volunteer, with an organization's invitation (link or code) or by asking to join one
  - [`app/signin.html`](app/signin.html): prototype sign-in (matches the email on the profile saved in this browser)
  - [`app/profile.html`](app/profile.html): user profile for volunteers and host team members
  - [`app/organization.html`](app/organization.html): host organization profile, with a Documents tab (events and profiles have one too)
  - [`app/events.html`](app/events.html): the organization's events, with main events and their sub-events
  - [`app/main-event.html`](app/main-event.html): a main event that groups sub-events, such as a festival and its rehearsals
  - [`app/event.html`](app/event.html): create and edit an event, with its roles and shifts
  - [`app/volunteers.html`](app/volunteers.html): the organization's volunteers: approve requests to join, invite people, approve automatically
  - [`app/dashboard.html`](app/dashboard.html): upcoming events and volunteers required vs enrolled
  - [`app/signup.html`](app/signup.html): volunteer side: available volunteer opportunities in two tabs (My organizations, All organizations) (where registered volunteers land from the home page), sign up for shifts (volunteers of that organization only), manage or cancel a sign-up
  - [`app/certificate.html`](app/certificate.html): a volunteer's certificate (view, download as PDF, print), or a preview for the organization before it's issued. Volunteers request certificates for a period on **My sign-ups**; the event admin approves their hours and an Admin issues them on **Manage → Volunteers**
  - [`app/verify.html`](app/verify.html): check a certificate is genuine from its number
  - [`app/review.html`](app/review.html): prototype stand-in for Sevak's staff: review organizations' verification requests (verify, or reject with a reason). An organization's Admin asks for verification at the top of its Organization page
  - [`app/outbox.html`](app/outbox.html): prototype outbox. There's no email yet, so every email Sevak would send (invitations, approvals, welcome, sign-up confirmations, verification decisions, certificate requests and certificates) is listed here, with its links working

**Demo data:** open [`app/dashboard.html?demo=1`](app/dashboard.html?demo=1) (or use **Load demo data** on the Dashboard) to add two demo organizations: *Riverside Community Arts* with main events, sub-events, roles, shifts, sign-ups, volunteers, two requests to join and one invitation, and *Eastside Food Pantry* with two events. It doesn't change other data, and **Remove demo data** clears it. If you're signed in when you load it, you're added to Riverside's team as an Admin, so the **Manage** links (Events, Volunteers, Dashboard, Organization) appear: in the header on Manage pages, under **⋯** elsewhere. Leave its team from My profile to see the volunteer-only view. On **Volunteers** there are two volunteers' hours to approve and a certificate request to issue. To try joining, use the invite codes **RIVER7** (Riverside) or **PANTRY** (the pantry) on the Join page. Everything is kept in the browser it was entered in, so a new or private (incognito) window starts empty; the Join page then offers to load the demo organizations. It also signs you up for a shift today and one in the past, so you can try checking in and logging your hours on **My sign-ups**.

## Preview locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Tests

Browser tests (Playwright) live in [`tests/`](tests/). With Node and Playwright installed:

```sh
tests/run.sh /tmp/sevak-shots   # serves the site on :8765, runs every tests/*-test.js, saves screenshots
```

## Publish with GitHub Pages

The site is deployed by the [`Deploy to GitHub Pages`](.github/workflows/pages.yml) workflow on
every push to `main`. It checks that local links and scripts exist, then publishes the files as
they are (no build step). One-time setup:

1. Go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

To redeploy without a new commit, open **Actions → Deploy to GitHub Pages → Run workflow**.

The site is published at <https://anbbala.github.io/sevak/>. If the repository is renamed, this
address changes to match the new name, and the old address does not redirect.
