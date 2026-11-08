# Sevak's deploy image: the Next.js server (apps/web) plus a small tasks
# script for migrations. Built by .github/workflows/deploy.yml and run on
# Google Cloud Run. Build from the repository root: docker build -t sevak .

# ---- Build ----
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @sevak/web build \
 && pnpm --filter @sevak/core bundle:tasks

# ---- Run ----
FROM node:22-slim AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    SEVAK_MIGRATIONS_DIR=/app/tasks/migrations
WORKDIR /app
# The server, the files it serves, and the migration task.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/packages/core/dist/tasks.mjs ./tasks/tasks.mjs
COPY --from=build --chown=node:node /repo/packages/db/migrations ./tasks/migrations
# Never run as root.
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
