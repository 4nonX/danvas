#!/usr/bin/env bash
# Update to the current state of the repository: back up the database,
# rebuild, recreate the container, check that the new version answers.
#   ./update.sh          pulls main (fast-forward only)
#   ./update.sh v1.0.0   switches to that tag
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ge 1 ]; then git -C .. fetch --tags && git -C .. checkout "$1"; else git -C .. pull --ff-only; fi

mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U danvas -d danvas -Fc > "backups/danvas-$stamp.dump"
echo "Database backup: deploy/backups/danvas-$stamp.dump"

./fetch-bg-model.sh

DANVAS_VERSION="v$(tr -d '[:space:]' < ../VERSION)"
if grep -q '^DANVAS_VERSION=' .env; then sed -i "s|^DANVAS_VERSION=.*|DANVAS_VERSION=${DANVAS_VERSION}|" .env; else echo "DANVAS_VERSION=${DANVAS_VERSION}" >> .env; fi
docker compose build app
docker compose up -d --force-recreate app

port=$(grep -E '^APP_PORT=' .env | cut -d= -f2); port=${port:-8005}
for _ in $(seq 1 60); do
  v=$(curl -fsS "http://127.0.0.1:${port}/healthz" 2>/dev/null || true)
  case "$v" in *"$DANVAS_VERSION"*) echo "running: $v"; exit 0;; esac
  sleep 3
done
echo "The new version does not answer. Logs: docker compose logs app; backup: backups/danvas-$stamp.dump" >&2
exit 1
