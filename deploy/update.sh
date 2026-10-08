#!/usr/bin/env bash
# Update this instance: back up the database, switch to the new release, pull
# (or, with the build override, rebuild) the image, recreate the app and check
# that the new version answers. Migrations run automatically on start.
#   ./update.sh          the latest release
#   ./update.sh v0.1.7   that release
# In a clone of the repository the clone is switched to the release tag too.
set -euo pipefail
cd "$(dirname "$0")"

REPO="${DANVAS_REPO:-4nonX/danvas}"

# This folder is deploy/ of a danvas clone only when the parent has danvas's
# own files. A stack folder that merely sits inside another repository (a
# GitOps repo, say) is never treated as one: its git, Dockerfile and compose
# files are not ours to pull, check out or build.
in_clone() {
  [ -f ../VERSION ] && [ -f ../Dockerfile ] && [ -f ../compose/compose.yml ] && [ -f ../scripts/fetch-bg-model.mjs ]
}
target="${1:-}"
if [ -z "$target" ]; then
  target=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$target" ] || { echo "Could not look up the latest release of ${REPO}." >&2; exit 1; }
fi
echo "Updating to ${target}"

if in_clone && [ -d ../.git ]; then git -C .. fetch --tags && git -C .. checkout "$target"; fi

mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U danvas -d danvas -Fc > "backups/danvas-$stamp.dump"
echo "Database backup: backups/danvas-$stamp.dump"

set_env() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
previous=$(grep -E '^DANVAS_VERSION=' .env | cut -d= -f2- || true)
set_env DANVAS_VERSION "$target"

if ! grep -q '^COMPOSE_FILE=.*compose.build.yaml' .env && ! docker compose pull app; then
  if ! in_clone; then
    set_env DANVAS_VERSION "$previous"
    echo "Could not pull the image for ${target}; still running ${previous:-the previous version}." >&2
    exit 1
  fi
  echo "The image for ${target} could not be pulled; building it from this clone instead."
  set_env COMPOSE_FILE compose.yaml:compose.build.yaml
fi
if grep -q '^COMPOSE_FILE=.*compose.build.yaml' .env; then docker compose build app; fi
docker compose up -d

port=$(grep -E '^APP_PORT=' .env | cut -d= -f2); port=${port:-8005}
for _ in $(seq 1 60); do
  v=$(curl -fsS "http://127.0.0.1:${port}/healthz" 2>/dev/null || true)
  case "$v" in *"\"${target}\""*) echo "running: $v"; exit 0;; esac
  sleep 3
done
echo "The new version does not answer. Logs: docker compose logs app; backup: backups/danvas-$stamp.dump" >&2
exit 1
