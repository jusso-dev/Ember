# Production multi-stage image for ember-control-plane.
# Web UI is a separate Node image or static deploy; see docker-compose.yml.

ARG RUST_VERSION=1.80

FROM rust:${RUST_VERSION}-slim-bookworm AS builder
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY shared ./shared
COPY control-plane ./control-plane
COPY agent ./agent

RUN cargo build --release -p ember-control-plane

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 ember

WORKDIR /app
COPY --from=builder /src/target/release/ember-control-plane /usr/local/bin/ember-control-plane

ENV EMBER_BIND_ADDR=0.0.0.0:8080 \
    EMBER_DB_URL=sqlite:///data/ember.db?mode=rwc \
    EMBER_PUBLIC_BASE_URL=http://127.0.0.1:3000 \
    RUST_LOG=info,sqlx=warn,tower_http=info

RUN mkdir -p /data && chown -R ember:ember /data /app
USER ember
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:8080/api/health" || exit 1

ENTRYPOINT ["ember-control-plane"]
