# Sevak: runbook

**Updated:** 2026-11-13

What to do when something goes wrong, or someone asks for something only Sevak staff can do. Each
section is a checklist. Commands use `PROJECT` (the environment's Google Cloud project), `REGION`
(`us-central1`) and the names `infra/gcp/setup.sh` creates: the service `sevak-web` and the
database instance `sevak-db`. They work the same on staging and production; try them on staging
first.

You need the Google Cloud project's Owner role (or the narrower roles each step names), and the
`gcloud` command signed in as yourself, never as the deploy account.

## 1. The site is down or broken after a release

The **Sevak is down** alert emails you when the health check fails (`setup.sh --alert-email`).

1. Check https://staging.sevak.theanbgroup.com/api/v1/health (or production's), and the latest
   **Deploy** run in GitHub Actions.
2. **Go back to the previous version.** Cloud Run keeps every version (revision). List them, newest
   first, and send all traffic to the last good one:
   ```sh
   gcloud run revisions list --service sevak-web --project PROJECT --region REGION
   gcloud run services update-traffic sevak-web --to-revisions REVISION=100 --project PROJECT --region REGION
   ```
   The console does the same: Cloud Run → sevak-web → Revisions → Manage traffic.
3. Database changes only ever add (`CLAUDE.md`), so the previous version still works with the
   newer database. Don't undo a migration by hand.
4. Fix the cause in a pull request. The next deploy sends traffic to the new version again.
5. Say what happened, and what you changed, in the pull request.

## 2. Getting data back (backups)

The database is backed up every night at 08:00 UTC and Cloud SQL keeps 7 backups (its default; the
Privacy Policy says so). Deleted organizations and events are also kept as "buried" ids, but their
contents are gone.

**Never restore over the live database to get one record back.** Restore into a separate instance,
copy out what's needed, then delete it.

```sh
gcloud sql backups list --instance sevak-db --project PROJECT
# A scratch instance the size of the real one (it costs while it exists).
gcloud sql instances create sevak-restore --database-version POSTGRES_18 --edition enterprise \
  --tier db-f1-micro --region REGION --project PROJECT
gcloud sql backups restore BACKUP_ID --backup-instance sevak-db --restore-instance sevak-restore --project PROJECT
# Look at it with Cloud SQL Studio (console) or the Cloud SQL Auth Proxy, copy out what you need,
# then:
gcloud sql instances delete sevak-restore --project PROJECT
```

Only if the whole live database is lost or damaged: restore the backup into `sevak-db` itself (the
same command with `--restore-instance sevak-db`). Everything since that backup is lost, so first
take a backup of the damaged one: `gcloud sql backups create --instance sevak-db`.

**Try a restore once a month** (into `sevak-restore`, on staging), so you know it works before you
need it.

## 3. Someone asks to have their account deleted, or for a copy of their data

The Privacy Policy promises both, by email to the privacy address. Answer within 30 days.

1. Check it's really them: reply to the email address on the account and ask them to confirm.
2. **A copy of their data:** signed in as themselves they see everything Sevak keeps about them
   (My profile, My sign-ups, documents, certificates). Ask them to save those pages, or send them
   the rows below as a file.
3. **Deletion:** ask them to tap **Delete my profile** on My profile first (it removes their profile,
   their documents and what organizations see of their profile). Then, in Cloud SQL Studio on the
   production database:
   ```sql
   -- Their account and every session (they're signed out everywhere).
   DELETE FROM users WHERE email = 'person@example.com';
   -- Their memberships of organizations.
   DELETE FROM records WHERE collection = 'memberships' AND lower(data->>'email') = 'person@example.com';
   ```
   Their sign-ups, hours and certificates stay with the organizations, as the Privacy Policy says.
4. Reply to say it's done.

## 4. "Who did this?" (the audit log)

Every record changed through the API is in `audit_log`: who (`actor_email`), when (`at`), what
(`collection`, `record_id`, `org_id`), whether it was `created`, `changed` or `deleted`, and in
`detail` the fields that changed and the decisions (statuses, hours, a team's roles). It doesn't
copy names, notes or phone numbers. In Cloud SQL Studio:

```sql
-- Everything that happened to one record, oldest first.
SELECT at, actor_email, action, detail FROM audit_log
WHERE collection = 'signups' AND record_id = 'signup-…' ORDER BY at;

-- Everything one person did in the last week.
SELECT at, action, collection, record_id, detail FROM audit_log
WHERE actor_email = 'person@example.com' AND at > now() - interval '7 days' ORDER BY at;

-- An organization's changes to its team.
SELECT at, actor_email, detail->'team' FROM audit_log
WHERE collection = 'organizations' AND record_id = 'org-…' AND detail->'fields' ? 'team' ORDER BY at;
```

## 5. An account was used by someone else, or a key leaked

- **A person's account:** they can tap **Sign out on all devices** on My profile. Or delete their
  sessions yourself: `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = '…');`
  Then look at what that account did (section 4).
- **A Sevak staff account:** do the same, remove the email from `SEVAK_PLATFORM_ADMINS` (GitHub
  environment variable) and deploy. Turn on `SEVAK_STAFF_GOOGLE_ONLY` if it isn't already
  (`docs/ENVIRONMENTS.md`).
- **The Resend key:** create a new key in Resend, put it in the GitHub environment secret
  `RESEND_API_KEY`, deploy, then delete the old key in Resend.
- **The database password:** `setup.sh` sets one only when the `database-url` secret has no
  value. So disable its current version, run `infra/gcp/setup.sh` again for the environment (it sets
  a new password and stores it), and deploy straight away. Between the two, the site can't reach
  its database, so do it at a quiet time:
  ```sh
  gcloud secrets versions list database-url --project PROJECT
  gcloud secrets versions disable VERSION --secret database-url --project PROJECT
  ```
- **Never replace `app-secrets-key`**: every organization's Zeffy connection would stop working.
  If it leaked, ask each organization to disconnect and reconnect Zeffy after it's replaced.

## 6. Someone reports a security problem

`/.well-known/security.txt` tells researchers to email the security address.

1. Thank them, and say when you'll reply in full (within a week).
2. Reproduce it on **staging**, never with real organizations' data.
3. Fix it in a pull request (the steward checklist in `.claude/skills/steward/SKILL.md` applies),
   release it, then tell them.
4. If personal data was exposed, write down what, whose, and when (the audit log helps), and get
   advice on whether people or authorities must be told.
