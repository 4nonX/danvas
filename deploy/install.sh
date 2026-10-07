#!/usr/bin/env bash
# First-time setup of a danvas instance on this host:
#   1. create .env from .env.example and generate the secrets
#   2. create the data folders, mirror the background-removal model
#   3. build the image, start everything, wait for the health check
# Then: review APP_URL and friends in .env, create an account in the browser.
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker is missing." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose (v2) is missing." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is missing (needed for the model download)." >&2; exit 1; }

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

mkdir -p data/storage data/static-data data/pgdata
./fetch-bg-model.sh

# Record the version in .env: compose.yaml names the image after it, also for
# a later manual "docker compose up".
DANVAS_VERSION="v$(tr -d '[:space:]' < ../VERSION)"
if grep -q '^DANVAS_VERSION=' .env; then sed -i "s|^DANVAS_VERSION=.*|DANVAS_VERSION=${DANVAS_VERSION}|" .env; else echo "DANVAS_VERSION=${DANVAS_VERSION}" >> .env; fi
docker compose build app
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
