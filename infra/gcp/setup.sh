#!/usr/bin/env bash
# One-time setup of a Sevak environment in Google Cloud. Run it in Cloud
# Shell (https://shell.cloud.google.com), signed in as a project Owner, once
# per environment, each in its own project. Step-by-step guide:
# infra/gcp/README.md.
#
#   bash infra/gcp/setup.sh --project <staging-project-id> --env staging --repo anb-solutions/sevak --budget 25
#   bash infra/gcp/setup.sh --project <prod-project-id> --env production --repo anb-solutions/sevak --budget 25
#
# Safe to run again: anything already set up is left as it is.
#
# What it sets up:
#   - PostgreSQL 18 on Cloud SQL (smallest size), with database and user "sevak".
#     Use --database external to bring your own (for example Neon) instead.
#   - Secret Manager secret "database-url", filled in automatically for Cloud SQL
#   - Artifact Registry repository "sevak" for container images, keeping only recent ones
#   - Service account sevak-runtime: what the app runs as
#   - Service account sevak-deployer: what GitHub Actions deploys as
#   - Workload Identity Federation: GitHub Actions signs in without stored keys,
#     and only from this repository's branch for this environment
#     (main → staging, production → production)
#   - Optional monthly budget alert (--budget <US dollars>)
set -euo pipefail

REGION="us-central1"
PROJECT="" ENV="" REPO="" DATABASE="cloudsql" BUDGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --database) DATABASE="$2"; shift 2 ;;
    --budget) BUDGET="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$ENV" in
  staging) BRANCH="main" ;;
  production) BRANCH="production" ;;
  *) echo "Use --env staging or --env production" >&2; exit 2 ;;
esac
case "$DATABASE" in cloudsql|external) ;; *) echo "Use --database cloudsql or --database external" >&2; exit 2 ;; esac
[ -n "$PROJECT" ] && [ -n "$REPO" ] || { echo "Use --project <id> and --repo <owner/name>" >&2; exit 2; }

say() { printf '\n== %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

# GitHub's numeric id for the repository. Unlike its name, it stays the same
# if the repository is renamed or moved to an organization.
REPO_ID="$(curl -fsSL "https://api.github.com/repos/$REPO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

RUNTIME_SA="sevak-runtime@$PROJECT.iam.gserviceaccount.com"
DEPLOY_SA="sevak-deployer@$PROJECT.iam.gserviceaccount.com"
INSTANCE="sevak-db"
CONNECTION=""

say "Turning on the Google Cloud services Sevak uses"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com
if [ "$DATABASE" = "cloudsql" ]; then gcloud services enable sqladmin.googleapis.com; fi

say "Container image repository (keeps the 10 most recent images, deletes others after 30 days)"
exists gcloud artifacts repositories describe sevak --location "$REGION" ||
  gcloud artifacts repositories create sevak --location "$REGION" --repository-format docker \
    --description "Sevak container images"
POLICY="$(mktemp)"
cat > "$POLICY" <<'JSON'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"olderThan": "30d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies sevak --location "$REGION" --policy "$POLICY" >/dev/null
rm -f "$POLICY"

say "Service accounts"
exists gcloud iam service-accounts describe "$RUNTIME_SA" ||
  gcloud iam service-accounts create sevak-runtime --display-name "Sevak app (runs on Cloud Run)"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create sevak-deployer --display-name "Sevak deploys (GitHub Actions)"

say "Deploy permissions: Cloud Run, pushing images, running as sevak-runtime"
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/run.admin --condition None >/dev/null
gcloud artifacts repositories add-iam-policy-binding sevak --location "$REGION" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/iam.serviceAccountUser >/dev/null

say "Let GitHub Actions sign in, only from $REPO on branch $BRANCH"
exists gcloud iam workload-identity-pools describe github --location global ||
  gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
CONDITION="assertion.repository_id == '$REPO_ID' && assertion.ref == 'refs/heads/$BRANCH'"
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref"
if exists gcloud iam workload-identity-pools providers describe github-actions --location global --workload-identity-pool github; then
  gcloud iam workload-identity-pools providers update-oidc github-actions --location global \
    --workload-identity-pool github --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION" >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc github-actions --location global \
    --workload-identity-pool github --display-name "GitHub Actions" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION"
fi
POOL="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/$POOL/attribute.repository_id/$REPO_ID" >/dev/null

if [ "$DATABASE" = "cloudsql" ]; then
  say "PostgreSQL on Cloud SQL (smallest size). Creating it takes 5 to 10 minutes."
  if ! exists gcloud sql instances describe "$INSTANCE"; then
    if [ "$ENV" = "production" ]; then
      safety=(--backup-start-time 08:00 --deletion-protection) # nightly backups; can't be deleted by accident
    else
      safety=(--no-backup) # staging holds only demo data
    fi
    gcloud sql instances create "$INSTANCE" --database-version POSTGRES_18 --edition enterprise \
      --tier db-f1-micro --region "$REGION" --availability-type zonal \
      --storage-type SSD --storage-size 10 --ssl-mode ENCRYPTED_ONLY \
      --root-password "$(openssl rand -hex 24)" "${safety[@]}"
  fi
  exists gcloud sql databases describe sevak --instance "$INSTANCE" ||
    gcloud sql databases create sevak --instance "$INSTANCE"
  CONNECTION="$PROJECT:$REGION:$INSTANCE"
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$RUNTIME_SA" \
    --role roles/cloudsql.client --condition None >/dev/null
fi

say "Database connection secret"
exists gcloud secrets describe database-url ||
  gcloud secrets create database-url --replication-policy automatic
gcloud secrets add-iam-policy-binding database-url --member "serviceAccount:$RUNTIME_SA" \
  --role roles/secretmanager.secretAccessor >/dev/null
if [ -n "$(gcloud secrets versions list database-url --filter 'state=ENABLED' --format 'value(name)' --limit 1)" ]; then
  echo "Already has a value; left as it is."
elif [ "$DATABASE" = "cloudsql" ]; then
  # A new random password for the app's database user, saved straight into
  # the secret. Nobody sees it.
  PASSWORD="$(openssl rand -hex 24)"
  if exists gcloud sql users describe sevak --instance "$INSTANCE"; then
    gcloud sql users set-password sevak --instance "$INSTANCE" --password "$PASSWORD" >/dev/null
  else
    gcloud sql users create sevak --instance "$INSTANCE" --password "$PASSWORD" >/dev/null
  fi
  printf 'postgres://sevak:%s@localhost/sevak?host=/cloudsql/%s' "$PASSWORD" "$CONNECTION" |
    gcloud secrets versions add database-url --data-file=- >/dev/null
  unset PASSWORD
  echo "Saved the connection for the sevak user."
else
  echo "Paste the $ENV database connection string (postgres://...), then press Enter. It won't be shown:"
  read -rs DATABASE_URL
  [ -n "$DATABASE_URL" ] || { echo "Nothing entered. Run this script again to add it." >&2; exit 1; }
  printf '%s' "$DATABASE_URL" | gcloud secrets versions add database-url --data-file=- >/dev/null
  unset DATABASE_URL
  echo "Saved."
fi

if [ -n "$BUDGET" ]; then
  say "Budget alert: emails billing admins at 50%, 90% and 100% of \$$BUDGET a month"
  gcloud services enable billingbudgets.googleapis.com
  BILLING="$(gcloud billing projects describe "$PROJECT" --format 'value(billingAccountName)')"
  BILLING="${BILLING#billingAccounts/}"
  if gcloud billing budgets list --billing-account "$BILLING" --format 'value(displayName)' | grep -qx "Sevak $ENV"; then
    echo "Already set."
  else
    gcloud billing budgets create --billing-account "$BILLING" --display-name "Sevak $ENV" \
      --budget-amount "${BUDGET}USD" --filter-projects "projects/$PROJECT" \
      --credit-types-treatment exclude-all-credits \
      --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 >/dev/null
    echo "Created. A budget sends alerts; it doesn't stop spending."
  fi
fi

say "Done. Add these as variables on the GitHub environment \"$ENV\""
echo "(GitHub: repository Settings → Environments → $ENV → Environment variables)"
echo
echo "  GCP_PROJECT_ID         $PROJECT"
echo "  GCP_REGION             $REGION"
echo "  GCP_WIF_PROVIDER       $POOL/providers/github-actions"
echo "  GCP_DEPLOY_SA          $DEPLOY_SA"
echo "  GCP_RUNTIME_SA         $RUNTIME_SA"
if [ -n "$CONNECTION" ]; then echo "  GCP_CLOUDSQL_INSTANCE  $CONNECTION"; fi
echo
echo "None of these are secrets. No keys were created."
