# danvas - single application image. The Go backend (REST + /realtime
# WebSocket) serves the statically-exported Next.js frontend on one port and runs
# its SQL migrations on boot. Postgres is an external service (see
# deploy/compose.yaml). ffmpeg is included for video export, and the
# background-removal model is served from the image itself.
#
# Multi-arch: the build stages run on the build machine's own platform
# ($BUILDPLATFORM): the frontend export and the model files are platform
# independent and Go cross-compiles, so only the small runtime stage is built
# per target platform. Published by .github/workflows/image.yml.

# ---------------------------------------------------------------------------
# Stage 1: build the frontend static export
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:24-bookworm AS frontend
WORKDIR /app
COPY . .
# The lockfile records every platform's native deps (lightningcss, swc, rollup)
# with cpu/os metadata, so `npm ci` installs the right ones for this build
# platform and the image stays exactly reproducible.
RUN npm ci --no-audit --no-fund
# build:dist -w frontend bakes NEXT_PUBLIC_BACKEND_URL=/api into the export.
RUN npm run build:packages && npm run build:dist -w frontend

# ---------------------------------------------------------------------------
# Stage 2: mirror the background-removal model
# ---------------------------------------------------------------------------
# The instance serves the model itself (STATIC_DATA_DIR), so background
# removal works without the vendor's CDN, also on hosts without internet
# access. Every file is checked against the vendor's SHA-256. Only the
# lockfile, the version check and the script are copied, so this layer is
# cached until the background-removal version changes.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS bgmodel
WORKDIR /app
COPY package-lock.json ./
COPY frontend/src/lib/imageFilters.ts frontend/src/lib/imageFilters.ts
COPY scripts/fetch-bg-model.mjs scripts/fetch-bg-model.mjs
RUN node scripts/fetch-bg-model.mjs /out

# ---------------------------------------------------------------------------
# Stage 3: build the Go backend binary
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26-bookworm AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Stage the frontend export into the Go module so go:embed bakes it into the
# binary (single self-contained file; no sidecar public/ at runtime).
COPY --from=frontend /app/frontend/out ./internal/webui/public
# Static (CGO off) so it runs on the slim runtime base. -tags embed bakes the
# frontend in; migrations, seed catalogs, and fonts are always embedded. The
# version is stamped into the binary for boot logs and the health endpoints:
# the VERSION build arg when given (deploy/compose.yaml passes it), otherwise
# v<VERSION file>, so every image reports the release it was built from.
# TARGETOS/TARGETARCH (set by BuildKit) select the cross-compile target.
COPY VERSION /VERSION
ARG VERSION=
ARG TARGETOS
ARG TARGETARCH
RUN v="${VERSION:-v$(tr -d '[:space:]' < /VERSION)}" \
 && CGO_ENABLED=0 GOOS="${TARGETOS:-linux}" GOARCH="${TARGETARCH}" go build -tags embed -trimpath \
    -ldflags "-s -w -X main.version=${v}" \
    -o /out/hycanvas ./cmd/api

# ---------------------------------------------------------------------------
# Stage 4: runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
WORKDIR /app

# What registries and container dashboards show. The release workflow adds
# the version, commit and build date; the icon and web-UI labels are read by
# Unraid and Artifact Hub (Portainer and others show the title and URLs).
LABEL org.opencontainers.image.title="danvas" \
      org.opencontainers.image.description="Self-hostable design platform: presentations, video, whiteboards, docs and print exports in the browser. An unofficial, modified version of HyCanvas by HyScaler." \
      org.opencontainers.image.licenses="Elastic-2.0" \
      org.opencontainers.image.url="https://github.com/4nonX/danvas" \
      org.opencontainers.image.source="https://github.com/4nonX/danvas" \
      org.opencontainers.image.documentation="https://github.com/4nonX/danvas/blob/main/deploy/README.md" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/4nonX/danvas/main/frontend/public/icon-512.png" \
      net.unraid.docker.webui="http://[IP]:[PORT:8005]/" \
      io.artifacthub.package.logo-url="https://raw.githubusercontent.com/4nonX/danvas/main/frontend/public/icon-512.png" \
      io.artifacthub.package.readme-url="https://raw.githubusercontent.com/4nonX/danvas/main/deploy/README.md" \
      io.artifacthub.package.license="Elastic-2.0"

# ffmpeg: video export. ca-certificates: outbound TLS (AI providers, SSO).
# curl: container healthcheck against /healthz. tzdata: TZ=Europe/Berlin and
# friends work. The upgrade pulls in Debian security fixes the base image tag
# does not carry yet (release scans fail on fixed CRITICAL CVEs, e.g.
# perl-base). setpriv (util-linux, always present) drops to the app user.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 danvas \
 && useradd --uid 1000 --gid 1000 --home-dir /app --no-create-home --shell /usr/sbin/nologin danvas

COPY --from=backend /out/hycanvas /app/hycanvas
# The model files, with the background remover's license (AGPL-3.0; the
# model and the ONNX runtime it lists are MIT).
COPY --from=bgmodel /out /app/static-data
COPY --from=frontend /app/node_modules/@imgly/background-removal/LICENSE.md /app/node_modules/@imgly/background-removal/ThirdPartyLicenses.json /app/static-data/bg-removal/
# Runs danvas as the unprivileged user (PUID/PGID). CRs are stripped so a
# Windows checkout cannot break the script.
COPY docker/entrypoint.sh /usr/local/bin/danvas-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/danvas-entrypoint && chmod 0755 /usr/local/bin/danvas-entrypoint

ENV PORT=8005 \
    DB_AUTO_MIGRATE=true \
    STORAGE_DRIVER=local \
    LOCAL_STORAGE_PATH=/app/.data/storage \
    STATIC_DATA_DIR=/app/static-data \
    TZ=UTC \
    PUID=1000 \
    PGID=1000

EXPOSE 8005
# Persist uploads/exports/snapshots when using the local storage driver.
VOLUME ["/app/.data/storage"]

# The Go binary serves /healthz once its HTTP listener is up.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/healthz" || exit 1

# Arguments are passed on to the danvas binary.
ENTRYPOINT ["danvas-entrypoint"]
