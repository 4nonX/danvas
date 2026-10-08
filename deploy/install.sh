#!/usr/bin/env bash
# First-time setup of a danvas instance on this host. Works in deploy/ of a
# clone of the repository, or on its own in an empty folder:
#
#   curl -fsSL https://raw.githubusercontent.com/4nonX/danvas/main/deploy/install.sh -o install.sh
#   bash install.sh
#
#   1. pick the version (the latest release; in a clone, the clone's VERSION)
#   2. fetch compose.yaml, .env.example and update.sh when missing
#   3. create .env and generate the secrets
#   4. pull the image (or build it: install.sh --build, in a clone), start
#      everything, wait for the health check
# Then: review APP_URL and friends in .env, create an account in the browser.
set -euo pipefail
cd "$(dirname "$0")"

REPO="${DANVAS_REPO:-4nonX/danvas}"
BUILD=false
[ "${1:-}" = "--build" ] && BUILD=true

command -v docker >/dev/null || { echo "Docker is missing." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose (v2) is missing." >&2; exit 1; }
# compose.yaml reads .env as an optional env_file, which needs Compose 2.24+.
cv=$(docker compose version --short 2>/dev/null | sed 's/^v//')
case "$cv" in
  1.*|2.[0-9].*|2.1[0-9].*|2.2[0-3].*) echo "Docker Compose ${cv} is too old; 2.24 or newer is needed." >&2; exit 1 ;;
esac
command -v curl >/dev/null || { echo "curl is missing." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is missing." >&2; exit 1; }

# A clone runs its own version; a standalone folder runs the latest release.
if [ -f ../VERSION ] && [ -f ../Dockerfile ]; then
  DANVAS_VERSION="v$(tr -d '[:space:]' < ../VERSION)"
else
  [ "$BUILD" = true ] && { echo "--build needs a clone of the repository." >&2; exit 1; }
  DANVAS_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$DANVAS_VERSION" ] || { echo "Could not look up the latest release of ${REPO}." >&2; exit 1; }
  for f in compose.yaml .env.example update.sh; do
    if [ ! -f "$f" ]; then
      curl -fsSL "https://raw.githubusercontent.com/${REPO}/${DANVAS_VERSION}/deploy/${f}" -o "$f"
      echo "Fetched ${f} (${DANVAS_VERSION})."
    fi
  done
  chmod +x update.sh
fi
echo "danvas ${DANVAS_VERSION}"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env."
fi
# Fill empty secrets (existing values are left alone).
for key in JWT_SECRET AI_SECRET POSTGRES_PASSWORD; do
  if grep -qE "^${key}=$" .env; then
    sed -i "s|^${key}=$|${key}=$(openssl rand -hex 32)|" .env
    echo "Generated ${key}."
  fi
done

set_env() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
# The version is pinned in .env: compose.yaml pulls exactly this release, also
# for a later manual "docker compose up -d".
set_env DANVAS_VERSION "$DANVAS_VERSION"
if [ "$BUILD" = true ]; then set_env COMPOSE_FILE compose.yaml:compose.build.yaml; fi

mkdir -p data/storage data/pgdata

if ! grep -q '^COMPOSE_FILE=.*compose.build.yaml' .env && ! docker compose pull; then
  # In a clone the image can always be built from source instead.
  [ -f ../Dockerfile ] || { echo "Could not pull the image for ${DANVAS_VERSION}." >&2; exit 1; }
  echo "The image for ${DANVAS_VERSION} could not be pulled; building it from this clone instead."
  set_env COMPOSE_FILE compose.yaml:compose.build.yaml
fi
if grep -q '^COMPOSE_FILE=.*compose.build.yaml' .env; then
  docker compose pull db
  docker compose build app
fi
docker compose up -d

port=$(grep -E '^APP_PORT=' .env | cut -d= -f2); port=${port:-8005}
echo -n "Waiting for danvas"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
    echo " ok: $(curl -fsS "http://127.0.0.1:${port}/healthz")"
    echo "Continue in the browser at $(grep -E '^APP_URL=' .env | cut -d= -f2-)"
    exit 0
  fi
  echo -n "."; sleep 3
done
echo; echo "No health check after 3 minutes: docker compose logs app" >&2
exit 1
