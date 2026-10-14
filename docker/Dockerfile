# syntax=docker/dockerfile:1

# One image for both runtime processes; docker-compose picks the entry point per service. Two
# targets: `runtime` (the default, last stage) carries only the application; `demo`, which compose
# builds, adds the seed and the demo script, which create accounts with a published password and
# sign e-signature callbacks, so they never ship in the production image.
FROM node:24.19.0-trixie-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY scripts/seed.ts scripts/seed-vat.ts scripts/demo.ts scripts/demo-users.ts ./scripts/
RUN pnpm build

# Production dependencies only. Lifecycle scripts are skipped: husky is a dev tool and the native
# modules we depend on ship prebuilt binaries.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# The code belongs to root and only runs as node: a compromised process cannot rewrite it.
FROM base AS app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/src/main.api.js"]

# The local stack: the application plus `dist/scripts`, so
# `docker compose exec api node dist/scripts/demo.js` works.
FROM app AS demo
COPY --from=build /app/dist/scripts ./dist/scripts

FROM app AS runtime
