# Postgres for local development with the extensions the diagnostics tooling uses:
# pg_stat_statements (bundled, preloaded by compose) and hypopg (hypothetical indexes).
# Same base as the Testcontainers image, so tests and the compose stack run one Postgres build.
FROM postgres:16.15-alpine

ARG HYPOPG_VERSION=1.4.3
RUN apk add --no-cache --virtual .build-deps build-base curl \
  && curl -fsSL "https://github.com/HypoPG/hypopg/archive/refs/tags/${HYPOPG_VERSION}.tar.gz" \
    | tar -xz -C /tmp \
  && make -C "/tmp/hypopg-${HYPOPG_VERSION}" USE_PGXS=1 with_llvm=no install \
  && rm -rf "/tmp/hypopg-${HYPOPG_VERSION}" \
  && apk del .build-deps
