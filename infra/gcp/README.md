# Deploying Sevak to Google Cloud

Sevak runs on **Cloud Run** (serverless: it scales to zero when idle) with **PostgreSQL on Cloud
SQL**. There are two environments, each in its own Google Cloud project:

| Environment | Deploys from | Address | Data |
|---|---|---|---|
| **Staging** | `staging` (the default branch), after each reviewed merge | `staging.sevak.theanbgroup.com` | Demo data |
| **Production** | `main`, which only the owner can merge into | `sevak.theanbgroup.com` | Real data |

GitHub Actions deploys ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)). It
signs in to Google with short-lived credentials (no stored keys), and each project only accepts
deploys from its own branch. Each deploy:

1. Builds the container image ([`Dockerfile`](../../Dockerfile)) and stores it in the project.
2. Runs database migrations as a Cloud Run job. On staging, it also loads demo data.
3. Starts the new version **without traffic**, checks its health and, on staging, that it reads
   the demo event from the database. Only then are users switched to it. A broken version never
   reaches anyone.

## Cost

| Item | Monthly cost |
|---|---|
| Cloud SQL PostgreSQL, smallest size (`db-f1-micro`, 10 GB) | About $9–10 per environment |
| Cloud Run (app and migration job) | Usually $0 within the free tier at this size |
| Artifact Registry (images; only recent ones kept) | Under $1 |
| Secret Manager | $0 at this size |
| **Total** | **About $10 for staging; about $20 with production** |

The free trial's $300 in credits covers this at first. To save money on staging while nobody is
testing, stop its database (storage is still charged; the app shows errors until it's started
again):

```sh
gcloud sql instances patch sevak-db --activation-policy NEVER   # stop
gcloud sql instances patch sevak-db --activation-policy ALWAYS  # start
```

## Set up staging

You need: the staging Google Cloud project, with billing linked, and Owner access to it.

### 1. Run the setup script (about 15 minutes, mostly waiting for the database)

Open [Cloud Shell](https://shell.cloud.google.com) (signed in as `abhishek@theanbgroup.com`) and
run:

```sh
git clone https://github.com/anb-solutions/sevak.git && cd sevak
bash infra/gcp/setup.sh --project YOUR-STAGING-PROJECT-ID --env staging --repo anb-solutions/sevak --budget 25
```

- Replace `YOUR-STAGING-PROJECT-ID` with the project's **ID** (shown on the project dashboard; it
  can differ from the project's name).
- If the repository has moved (for example to `anbsolutions/sevak`), use the new name.
- `--budget 25` emails the billing admins at 50%, 90% and 100% of $25 a month, counting real
  usage even while credits pay for it. A budget sends alerts; it doesn't stop spending.

At the end, it prints five or six values. Keep the window open.

### 2. Add the values to GitHub

In the repository on GitHub: **Settings → Environments → New environment**, name it `staging`.

- Under **Deployment branches and tags**, choose **Selected branches** and add `staging`.
- Under **Environment variables**, add each value the script printed (`GCP_PROJECT_ID`,
  `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`, `GCP_CLOUDSQL_INSTANCE`).
  None of them are secrets.

### 3. Deploy

Merge a pull request into `staging` (or open **Actions → Deploy → Run workflow** on `staging`). When it finishes, the
run's summary links to the staging address, which looks like `https://sevak-web-….run.app`.
Check `…/api/v1/health` answers `{"ok":true}`.

### 4. Give staging its own address: `staging.sevak.theanbgroup.com`

You do the domain proof and the DNS record; the deploy workflow connects the address.

1. **Prove you own the domain** (once for theanbgroup.com): in Cloud Shell, run
   `gcloud domains verify theanbgroup.com`. It opens Google Search Console, which gives you a TXT
   record to add at your DNS provider. Click **Verify** once the record is in.
2. **Let the deploy account connect addresses:** open
   [Webmaster Central](https://www.google.com/webmasters/verification/details?domain=theanbgroup.com),
   choose **Add an owner**, and add
   `sevak-deployer@YOUR-STAGING-PROJECT-ID.iam.gserviceaccount.com`.
3. **Add the DNS record** at your DNS provider: a `CNAME` record named `staging.sevak` pointing to
   `ghs.googlehosted.com`.
4. **In GitHub**, add one more variable to the `staging` environment:
   `GCP_DOMAIN` = `staging.sevak.theanbgroup.com`.
5. **Run the deploy** (merge anything into `staging`, or **Actions → Deploy → Run workflow** on
   `staging`). Its last step, **Connect the custom domain**, connects the address and lists the DNS
   records it expects. Google then issues the HTTPS certificate on its own, usually within 15–60
   minutes.

If that step shows a warning, the deploy itself still succeeded; the warning says what's missing
(usually step 2).

Cloud Run's built-in domain mapping is a preview feature. That's fine for staging. Production
will use Firebase Hosting in front of Cloud Run (free), which Google supports for production use.

Once `GCP_DOMAIN` is set, links in Sevak's emails point at that address.

### 5. Send email (sign-in codes)

People sign in with a code that Sevak emails them. Until email is set up, staging writes each
code to its log instead: **Cloud Run → sevak-web → Logs**, search for `sign-in code`. That's fine
for a first look; set up email before others test.

Sevak sends through [Resend](https://resend.com) (why: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)
§3.5). **Staging and production are kept apart:** staging sends from
`notify@staging.sevak.theanbgroup.com` with "[Staging]" at the start of each subject, production
from `notify@sevak.theanbgroup.com`, each from its own Resend team with its own key. A test email
can never come from the real address, and a problem with one doesn't affect the other. About 10
minutes:

1. **Sign up** at resend.com with `ops@theanbgroup.com`, and name the team **Sevak Staging**. The
   free plan is enough.
2. **Add the domain** `staging.sevak.theanbgroup.com` (**Domains → Add domain**). Resend lists 3
   or 4 DNS records (an MX and TXT records on names like `send.staging.sevak`, and a DKIM TXT
   record on `resend._domainkey.staging.sevak`). Add them at your DNS provider exactly as shown;
   if it adds `.theanbgroup.com` itself, leave that part off. They sit beside the `staging.sevak`
   CNAME without touching it, and your own email at theanbgroup.com is unaffected. Click
   **Verify** once they're in.
3. **Create an API key** (**API Keys → Create**) with **Sending access** only, for that domain.
   Copy it (it starts with `re_`); Resend shows it once.
4. **Store it in staging's Google Cloud project.** In Cloud Shell, in the repository folder, run
   the setup script again with `--email resend` (the rest is left as it is) and paste the key when
   asked. It isn't shown and never goes into GitHub:
   ```sh
   bash infra/gcp/setup.sh --project YOUR-STAGING-PROJECT-ID --env staging --repo anb-solutions/sevak --email resend
   ```
5. **In GitHub**, add a variable to the `staging` environment: `GCP_EMAIL_SECRET` =
   `resend-api-key`. The next deploy sends real email.

Optional variables on the environment:

- `SEVAK_PLATFORM_ADMINS`: emails of Sevak staff, separated by commas. They can verify
  organizations (the Review page).
- `EMAIL_FROM`: a different sender than the default for that environment.

## Set up production (later)

1. Create a second Google Cloud project for production, and run the script with
   `--env production --email resend` and the new project's ID. Production's database gets nightly
   backups and deletion protection.
   Production won't start without email. Set it up as in staging's step 5, but in a separate
   Resend team, **Sevak Production** (or a second Resend account if your plan allows only one
   domain), with the domain `sevak.theanbgroup.com` and its own key.
2. In GitHub, **Settings → Rules → Rulesets → New branch ruleset** for `main`: restrict who can
   update it to yourself, and require a pull request.
3. Add a `production` environment in GitHub with **Deployment branches** set to `main`, the
   script's values, and **Required reviewers** set to yourself (so each production deploy waits
   for your approval).
4. Shipping to production is then: open a pull request from `staging` into `main`, review it,
   merge it, approve the deploy.

If the repository becomes private, GitHub's rulesets and environment reviewers need a paid GitHub
plan. Without them, the Google side still protects production: its project only accepts deploys
from the `main` branch.

## Using your own Postgres instead of Cloud SQL

Run the script with `--database external` (for example for Neon). It asks for the connection
string and stores it as the `database-url` secret, and doesn't create Cloud SQL. Leave
`GCP_CLOUDSQL_INSTANCE` out of the GitHub environment.

## If something goes wrong

- **"Permission denied" when GitHub Actions signs in:** the deploy ran from a branch the project
  doesn't accept (staging accepts only `staging`, production only `main`), or the repository's name or owner changed. Run the
  script again with the right `--repo`.
- **The site says it's forbidden:** your organization may require sign-in for Cloud Run. The
  deploy uses `--no-invoker-iam-check` to make the site public; an organization policy
  (`run.managed.requireInvokerIam`) can block that. An Organization Admin can allow it for this
  project.
- **The migration job fails:** open **Cloud Run → Jobs → sevak-tasks → Logs** in the console.
  Nothing has changed for users: the app is only updated after migrations succeed.
- **Roll back:** in **Cloud Run → sevak-web → Revisions**, send all traffic to the previous
  revision.
