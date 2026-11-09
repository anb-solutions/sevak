# Deploying Sevak to Google Cloud

This guide walks through staging step by step. For a checklist of everything an environment
needs (production, or any other), with every variable and secret in one table, see
[`docs/ENVIRONMENTS.md`](../../docs/ENVIRONMENTS.md).

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
2. Runs database migrations as a Cloud Run job, and on staging also loads demo data. The job takes
   about 2 minutes to start, so it only runs when something that affects the database changed
   since the live version (migrations, the schema, demo data, the task runner or dependencies).
   To run it anyway: **Actions → Deploy → Run workflow**, tick **Run database migrations**.
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
Anything put in front of Cloud Run adds its own address to `X-Forwarded-For`, which Sevak's
per-address limits read from the right: set the GitHub variable `SEVAK_PROXY_HOPS` to how many
addresses it adds after the person's plus one (see `clientIp` in `apps/web/src/lib/http.ts`), or everyone would
share one limit.

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

1. **Sign up** at resend.com with your own work account (for example `abhishek@theanbgroup.com`),
   turn on two-factor sign-in, and name the team **Sevak Staging**. The free plan is enough. Invite
   a second admin later so the account isn't tied to one person.
2. **Add the domain** `staging.sevak.theanbgroup.com` (**Domains → Add domain**). Resend lists 3
   or 4 DNS records (an MX and TXT records on names like `send.staging.sevak`, and a DKIM TXT
   record on `resend._domainkey.staging.sevak`). Add them at your DNS provider exactly as shown;
   if it adds `.theanbgroup.com` itself, leave that part off. They sit beside the `staging.sevak`
   CNAME without touching it, and your own email at theanbgroup.com is unaffected. Click
   **Verify** once they're in.
3. **Create an API key** (**API Keys → Create**) with **Sending access** only, for that domain.
   Copy it (it starts with `re_`); Resend shows it once.
4. **Once only: let deploys store keys.** Giving the deploy account a new permission needs a
   project Owner, so run the setup script once more in Cloud Shell, in the repository folder
   (`git pull` first). Everything already set up is left as it is:
   ```sh
   bash infra/gcp/setup.sh --project YOUR-STAGING-PROJECT-ID --env staging --repo anb-solutions/sevak
   ```
5. **In GitHub: Settings → Environments → staging → Environment secrets → Add secret**:
   `RESEND_API_KEY` = the key. GitHub never shows it again, even to you, and hides it in logs.
6. **Run the deploy** (**Actions → Deploy → Run workflow** on `staging`). It copies the key into
   staging's Secret Manager, where only the app can read it, and starts sending real email.

To change the key later (for example if it leaks), update the GitHub secret and run the deploy;
the old copy is turned off. To stop sending, delete the key in Resend.

### 6. Continue with Google (optional)

Adds a **Continue with Google** button to the sign-in page, next to the emailed code. Sevak asks
Google for the person's email address only. It accepts Gmail addresses and Google Workspace
accounts; people whose Google account uses another email provider are asked to use the emailed
code (Google's own advice, so an old address can't be taken over). Staging and production each
get their own Google sign-in setup, in their own Google Cloud project. About 10 minutes, in the
[Google Cloud console](https://console.cloud.google.com) with the **staging project** selected:

1. **Google Auth Platform → Branding** (or **APIs & Services → OAuth consent screen**) →
   **Get started**:
   - App name: `Sevak Staging`. User support email: your own.
   - Audience: **External**. Contact email: your own.
   - Leave the logo empty for now: adding one makes Google review the app first.
   - Under **Branding**, add the app home page `https://staging.sevak.theanbgroup.com`, privacy
     policy `https://staging.sevak.theanbgroup.com/privacy.html`, terms
     `https://staging.sevak.theanbgroup.com/terms.html`, and the authorized domain
     `theanbgroup.com`.
2. **Data access**: add nothing. Sevak only uses the basic `openid` and `email` scopes, which
   need no review by Google.
3. **Audience → Publish app**, so anyone with a Google account can sign in. (Left in *Testing*,
   only the test users you list can.)
4. **Clients → Create client** → *Web application*, named `Sevak staging`. Under **Authorized
   redirect URIs** add exactly
   `https://staging.sevak.theanbgroup.com/api/v1/auth/google/callback`. Create it, then copy the
   **Client ID** and the **Client secret** (Google may show the secret only once).
5. **In GitHub**, on the `staging` environment: add the **variable** `GOOGLE_CLIENT_ID` = the
   Client ID (it ends `.apps.googleusercontent.com`; it isn't a secret), and the **secret**
   `GOOGLE_CLIENT_SECRET` = the Client secret. (This needs step 5.4 above done once.)
6. **Run the deploy.** The button appears on the sign-in page.

If Google shows **redirect_uri_mismatch**, the address in step 4 doesn't exactly match
`GCP_DOMAIN` (check `https://`, no trailing slash).

### 7. Documents (uploaded files and certificate PDFs)

Files go in a private Cloud Storage bucket, one per environment: no public access, and only the
app can read or write it. The app checks who may see each file before serving it, and limits
uploads to 10 MB a file, 100 MB per person and 500 MB per organization, of PDFs, pictures, Office
and text files (checked by what the file really is, not its name). Cost: about $0.02 per GB a
month.

1. **Run the setup script once more** in Cloud Shell (`git pull` first; everything already set
   up is left as it is). It creates the bucket and prints `GCP_FILES_BUCKET`.
2. **In GitHub**, add the variable `GCP_FILES_BUCKET` to the `staging` environment with that
   value, and run the deploy. Until then, the Documents tabs say documents aren't set up yet.

### 8. Events from Zeffy

An organization's Admin can connect its Zeffy account (Manage → Events → **From Zeffy**) and
start Sevak events from its Zeffy events. They paste the organization's Zeffy API key (in Zeffy:
Settings → Integrations → API). Sevak stores it encrypted with `app-secrets-key`, a random key
the setup script makes and keeps in Secret Manager; nobody sees it, and GitHub never has it.

1. **Run the setup script once more** (`git pull` first). It makes `app-secrets-key` if it isn't
   there. Run the deploy afterwards. Until then, From Zeffy says it isn't set up yet.

Don't replace `app-secrets-key` once organizations have connected: the keys it encrypted would
stop working, and each organization would need to connect again.

Optional variables on the environment:

- `SEVAK_PLATFORM_ADMINS`: emails of Sevak staff, separated by commas. They can verify
  organizations (the Review page).
- `EMAIL_FROM`: a different sender than the default for that environment.

## Set up production (later)

The full checklist, with every variable and secret, is in
[`docs/ENVIRONMENTS.md`](../../docs/ENVIRONMENTS.md). In short:

1. Create a second Google Cloud project for production, and run the script with
   `--env production` and the new project's ID. Production's database gets nightly
   backups and deletion protection.
   Production won't start without email. Set it up as in staging's step 5 (secrets on the
   `production` environment in GitHub), but in a separate
   Resend team, **Sevak Production** (or a second Resend account if your plan allows only one
   domain), with the domain `sevak.theanbgroup.com` and its own key. For Continue with Google,
   repeat staging's step 6 in the production project, named `Sevak`, with
   `https://sevak.theanbgroup.com/...` addresses.
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
