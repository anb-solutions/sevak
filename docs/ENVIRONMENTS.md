# Setting up an environment

A checklist for standing up a Sevak environment from nothing: **production** when we get there,
or a fresh copy of staging. It lists every variable, secret, DNS record and outside account the
app needs, in the order to do them. [`infra/gcp/README.md`](../infra/gcp/README.md) explains the
same steps for staging at more length, with costs and troubleshooting.

## What an environment is

Each environment is a set of things kept apart from every other environment:

| Piece | Staging | Production |
|---|---|---|
| Git branch it deploys from | `staging` (every reviewed merge) | `main` (only the owner merges) |
| GitHub environment (variables and secrets) | `staging` | `production` |
| Google Cloud project | its own | its own, **separate** |
| Web address | `staging.sevak.theanbgroup.com` | `sevak.theanbgroup.com` |
| Email sender (Resend team and key) | `notify@staging.sevak.theanbgroup.com`, team "Sevak Staging" | `notify@sevak.theanbgroup.com`, team "Sevak Production" |
| Continue with Google (OAuth client) | "Sevak Staging", in the staging project | "Sevak", in the production project |
| Database | Cloud SQL, nightly backups, deletion protection | the same |
| Files bucket, `app-secrets-key` | in the staging project | in the production project |

Nothing is shared between them: no keys, no database, no email domain, no files. A mistake or
leak in one never touches the other.

Otherwise they're built and run **identically**: the same code, setup script, deploy steps,
database settings and checks. Neither gets demo data, and both must send real email. Only two
differences are on purpose:

- **Labels.** Staging says "Staging" at the top of every page, and staging emails start with
  "[Staging]", so nobody mistakes it for the real thing.
- **Approval.** Production deploys wait for the owner's approval.

## Before you start

- **A Google Cloud project** for the environment, with billing linked, and Owner access to it
  (signed in as yourself, for example `abhishek@theanbgroup.com`). Note its **ID** (on the
  project dashboard; it can differ from its name).
- **Admin access to the GitHub repository** (`anb-solutions/sevak`).
- **Access to the DNS** for `theanbgroup.com`.
- **A Resend account** (resend.com), for email.
- About an hour, mostly waiting for the database and DNS.

Placeholders below: `PROJECT-ID` is the new project's ID, `ENV` is `production` (or `staging`),
`DOMAIN` is the web address (`sevak.theanbgroup.com` for production).

## The checklist

### 1. Google Cloud: run the setup script (about 15 minutes)

In [Cloud Shell](https://shell.cloud.google.com), with the new project selected:

```sh
git clone --depth 1 https://github.com/anb-solutions/sevak.git ~/sevak-setup
cd ~/sevak-setup
bash infra/gcp/setup.sh --project PROJECT-ID --env ENV --repo anb-solutions/sevak --budget 25
```

If you already have a copy from before, `cd` into it and `git pull` instead of cloning. Running
the script again is always safe: anything already there is left as it is.

It sets up, in that project:

- **Cloud SQL PostgreSQL 18** (`sevak-db`, smallest size), its database and user, with nightly
  backups and deletion protection.
- **Secret Manager** secrets:
  - `database-url`: filled in by the script
  - `resend-api-key` and `google-client-secret`: empty places, which the deploy fills from
    GitHub
  - `app-secrets-key`: a random key made here, which never leaves Google Cloud
- **Artifact Registry** `sevak` for the app's images, keeping only recent ones.
- **A private bucket** `PROJECT-ID-sevak-files` for documents.
- **Two service accounts:**
  - `sevak-runtime`: what the app runs as
  - `sevak-deployer`: what GitHub Actions deploys as
- **Workload Identity Federation:** GitHub can deploy without a stored key, and only from this
  environment's branch.
- **A budget alert** at 50%, 90% and 100% of `--budget` dollars a month.
- **A "site is down" alert** (once the app has been deployed): see step 8.

At the end it prints the values for step 2. Keep the window open.

### 2. GitHub: create the environment

**Settings → Environments → New environment**, named exactly `ENV` (`production` or `staging`).

- **Deployment branches and tags:** *Selected branches*, add `main` for production (`staging` for
  staging).
- **Production only:** under **Required reviewers**, add yourself, so each production deploy
  waits for your approval.
- **Production only:** **Settings → Rules → Rulesets → New branch ruleset** for `main`. Restrict
  who can update it to yourself, and require a pull request.

Then add the **variables** the script printed (under **Environment variables**; none are
secrets):

| Variable | Value | Needed? |
|---|---|---|
| `GCP_PROJECT_ID` | the project's ID | Yes |
| `GCP_REGION` | `us-central1` | Yes |
| `GCP_WIF_PROVIDER` | `projects/…/locations/global/workloadIdentityPools/github/providers/github-actions` | Yes |
| `GCP_DEPLOY_SA` | `sevak-deployer@PROJECT-ID.iam.gserviceaccount.com` | Yes |
| `GCP_RUNTIME_SA` | `sevak-runtime@PROJECT-ID.iam.gserviceaccount.com` | Yes |
| `GCP_CLOUDSQL_INSTANCE` | `PROJECT-ID:us-central1:sevak-db` | Yes, with Cloud SQL |
| `GCP_FILES_BUCKET` | `PROJECT-ID-sevak-files` | For documents |

### 3. First deploy

- **Production:** open a pull request from `staging` into `main`, merge it, and approve the
  deploy.
- **Staging:** run **Actions → Deploy → Run workflow** on `staging`.

The run's summary links to an address like `https://sevak-web-….run.app`. Check
`…/api/v1/health` answers `{"ok":true}`.

Until email is set up (step 5), no sign-in code can be sent, so nobody can sign in yet. That's
expected; finish the checklist before anyone uses it.

### 4. The web address (about 30 minutes, mostly DNS)

1. **Once for theanbgroup.com** (already done for staging): in Cloud Shell, run
   `gcloud domains verify theanbgroup.com` and add the TXT record it gives you.
2. In [Webmaster Central](https://www.google.com/webmasters/verification/details?domain=theanbgroup.com),
   **Add an owner**: `sevak-deployer@PROJECT-ID.iam.gserviceaccount.com`.
3. **DNS:** add a `CNAME` from the address to `ghs.googlehosted.com`.
   - Staging's is `staging.sevak`.
   - Production's is `sevak`.
4. **GitHub variable:** `GCP_DOMAIN` = `DOMAIN`.
5. **Deploy again.** Its last step connects the address. Google issues the HTTPS certificate in
   15 to 60 minutes.

Links in emails, and Google sign-in, use this address. Set it before steps 5 and 6.

*Production, later:* Cloud Run's address mapping is a preview feature. Before real launch, we
plan to put Firebase Hosting in front (free, supported for production). Anything in front of
Cloud Run adds its own address to each request. So when that happens, set the GitHub variable
`SEVAK_PROXY_HOPS` to how many addresses it adds after the person's, plus one. Otherwise everyone
shares one sign-in limit. That isn't set up yet.

### 5. Email (required)

1. In Resend, create a **separate team** for the environment ("Sevak Production"). Turn on
   two-factor sign-in, and invite a second admin.
2. **Domains → Add domain:** `DOMAIN` (`sevak.theanbgroup.com`). Add the 3 or 4 DNS records it
   shows, exactly as shown, then **Verify**.
3. **API Keys → Create:** *Sending access* only, for that domain. Copy it (it starts with `re_`).
4. **GitHub secret** (**Environment secrets**, not variables): `RESEND_API_KEY` = the key.
5. **Deploy.** The deploy copies the key into the project's Secret Manager and switches email on.

By default, production sends from `Sevak <notify@sevak.theanbgroup.com>`, and staging from
`Sevak Staging <notify@staging.sevak.theanbgroup.com>` with "[Staging]" in front of subjects. To
use another sender, set the variable `EMAIL_FROM`.

### 6. Continue with Google (optional)

In the **environment's own** Google Cloud project:

1. **Google Auth Platform → Branding → Get started:**
   - app name `Sevak` (`Sevak Staging` for staging)
   - audience **External**
   - home page `https://DOMAIN`, privacy policy `https://DOMAIN/privacy.html`, terms
     `https://DOMAIN/terms.html`
   - authorized domain `theanbgroup.com`
   - leave the logo empty, since a logo makes Google review the app
2. **Data access:** add nothing. Sevak only uses `openid` and `email`.
3. **Audience → Publish app.**
4. **Clients → Create client → Web application.** Authorized redirect URI, exactly:
   `https://DOMAIN/api/v1/auth/google/callback`.
5. **GitHub:**
   - variable `GOOGLE_CLIENT_ID` (ends `.apps.googleusercontent.com`)
   - secret `GOOGLE_CLIENT_SECRET`
6. **Deploy.**

### 7. Sevak staff

**GitHub variable** `SEVAK_PLATFORM_ADMINS`: the emails of Sevak staff, separated by commas.
Staff verify organizations (the Review page) and can manage any organization, so keep the list
short. Deploy.

### 8. Alerts (about 5 minutes)

Two alerts, kept cheap, both emailed:

| Alert | What it watches | Cost |
|---|---|---|
| **Sevak is down** | Google checks `https://DOMAIN/api/v1/health` every 5 minutes from several places; an email when it fails from more than one, and another when it's back | Free checks; about $1.50 a month for the alert |
| **New errors** | Error Reporting groups errors from the app's log, and emails the first time a new kind appears | Free |

The budget alert (step 1) covers cost.

1. **Run the setup script again** once the address works (step 4), so the check uses it. It
   emails the account running it; pass `--alert-email someone@theanbgroup.com` for another
   address.
2. **New errors** can only be set up in the console: **Error Reporting → Configure
   notifications**, then tick the **Sevak alerts** channel the script made.
3. To see them work: **Monitoring → Uptime checks** shows *Sevak health* passing, and
   **Monitoring → Alerting** shows *Sevak is down*.

More alerts are worth adding when there's budget: floods of refused requests, sign-in emails
failing, the database filling up. See [When to add a firewall](#when-to-add-a-firewall).

### 9. Check it works

Do these on a phone-sized screen:

- [ ] `https://DOMAIN/api/v1/health` answers `{"ok":true}`.
- [ ] Sign in with an emailed code: the email arrives, from the right sender.
- [ ] Continue with Google works (if set up).
- [ ] Set up an organization, add an event, sign up for it from a second account.
- [ ] Upload a PDF on My profile → Documents (needs `GCP_FILES_BUCKET`).
- [ ] Events → From Zeffy shows "Connect Zeffy" (needs `app-secrets-key`, made in step 1).
- [ ] Staff: My profile shows "Review verification requests".
- [ ] Production: the yellow "Staging" banner is **not** shown.
- [ ] Monitoring → Uptime checks: *Sevak health* is passing.

## Everything in one place

### GitHub environment variables

These are not secrets.

| Variable | What it's for | Needed? |
|---|---|---|
| `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA` | Where to deploy, and how to sign in to Google | Yes (step 2) |
| `GCP_CLOUDSQL_INSTANCE` | The database's connection name | With Cloud SQL (step 2) |
| `GCP_FILES_BUCKET` | Private bucket for documents and certificate PDFs | For documents (step 2) |
| `GCP_DOMAIN` | The environment's web address; links in emails use it | Yes, for real use (step 4) |
| `GOOGLE_CLIENT_ID` | Continue with Google | Optional (step 6) |
| `SEVAK_PLATFORM_ADMINS` | Sevak staff emails, comma-separated | To verify organizations (step 7) |
| `EMAIL_FROM` | A different sender than the default | Optional |
| `SEVAK_PROXY_HOPS` | Only with a proxy (Firebase Hosting, a load balancer) in front of Cloud Run | Optional (step 4) |

### GitHub environment secrets

GitHub hides these. The deploy copies each one into the project's Secret Manager, and only the
app can read them there.

| Secret | Where it comes from | Needed? |
|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys, sending access, for this environment's domain | Yes: without it nobody can sign in |
| `GOOGLE_CLIENT_SECRET` | The OAuth client in this environment's project | With `GOOGLE_CLIENT_ID` |

### Made by the setup script (nothing to copy)

Secret Manager, in the project:

| Secret | What it holds |
|---|---|
| `database-url` | The database connection (Cloud SQL: made by the script) |
| `app-secrets-key` | Encrypts organizations' Zeffy keys. **Never replace it** once organizations have connected; they'd all have to connect again |
| `resend-api-key`, `google-client-secret` | Copies of the GitHub secrets, kept up to date by each deploy |

### DNS records at theanbgroup.com

| Record | Name | Value | For |
|---|---|---|---|
| TXT | `theanbgroup.com` | from `gcloud domains verify` | Proving the domain to Google, once |
| CNAME | `sevak` (production) or `staging.sevak` | `ghs.googlehosted.com` | The web address |
| MX and TXT records | names like `send.sevak`, `resend._domainkey.sevak` | exactly as Resend shows them | Sending email from that address |

### What the app is given

The deploy sets these on the app; you don't set them by hand. They're listed so the code makes
sense:

| Setting | Comes from |
|---|---|
| `SEVAK_ENV` | `production` from `main`, `staging` from `staging` |
| `APP_URL` | `https://` + `GCP_DOMAIN` |
| `DATABASE_URL` | Secret `database-url` |
| `EMAIL_MODE`, `RESEND_API_KEY` | `resend` and the key, once `resend-api-key` has one; otherwise `log`, which staging and production refuse |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The variable and the secret, when both are set |
| `SEVAK_FILES_BUCKET` | `GCP_FILES_BUCKET` |
| `SEVAK_SECRETS_KEY` | Secret `app-secrets-key` |
| `SEVAK_PLATFORM_ADMINS`, `EMAIL_FROM`, `SEVAK_PROXY_HOPS` | The variables of the same name |

Local development and tests use other settings: `SEVAK_FILES_DIR`, `ZEFFY_API_BASE` and
`DATABASE_URL` pointing at a test database. They're never set on staging or production.

## When to add a firewall

Today each environment's address goes straight to Cloud Run. In front of every Cloud Run service,
Google's front end already absorbs large network floods, at no cost. Sevak adds its own
protections: limits kept in the database (sign-in, saving, emails, invite codes), access checks
on every request, and a strict content security policy. For the pilot, that's the usual setup
for an app at this stage.

The next step is a Google Cloud **load balancer with Cloud Armor**. Cloud Armor is a web
application firewall: it blocks common attacks and floods at Google's edge, before they reach the
app, and can limit requests there. It costs about $20–25 a month per environment, and the setup
script can do all of it except one DNS record. Add it to **both** environments, so they stay
identical, when any of these happen:

- Sevak opens beyond the pilot organizations, or traffic grows a lot.
- There's revenue or a grant to cover it.
- Someone attacks it: floods of requests, or repeated attempts on sign-in.
- Google retires the address mapping we use now (it's still a preview feature).

At the same time, add the alerts that wait for budget (each about $1.50 a month): floods of
refused requests (a sign of an attack), sign-in emails failing, and the database's storage or CPU
above 80%.

Firebase Hosting is a free alternative front door, supported for production. But it has no
firewall, it only passes one cookie (named `__session`, so Sevak's `__Host-` sign-in cookie would
have to be renamed), and requests are capped at 60 seconds. It's a fallback if the address
mapping gives trouble before Cloud Armor is worth paying for.

## Rules for every environment

- **Never copy a key between environments.** Each has its own Resend team and key, its own Google
  client, its own `app-secrets-key` and its own database.
- **Secrets go in Environment secrets, never in variables.** Variables are shown in logs and to
  anyone with access to the repository. If a key was ever put in a variable, make a new one and
  delete the old one.
- **Never use production data anywhere else**: not on staging, not locally, not in tests.
- **Only the owner deploys production:** `main` is restricted, and each production deploy waits
  for approval.

## Adding a third environment

The deploy and the setup script know two environments: `staging` (branch `staging`) and
`production` (branch `main`). Another one (for example a demo for a partner) needs, in a pull
request:

1. In `infra/gcp/setup.sh`, accept the new `--env` name and its branch.
2. In `.github/workflows/deploy.yml`:
   - add the branch to `on.push.branches`
   - map it to its GitHub environment and `SEVAK_ENV`
   - give it its own labels, like staging's
3. Then follow this checklist for it, with its own project, address, Resend team and Google
   client.
