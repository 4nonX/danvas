#!/bin/sh
# Starts danvas as an unprivileged user (PUID:PGID, default 1000:1000), so
# files in the storage folder belong to that user on the host too.
#
# Started as root (the default), it first hands the app folder and the local
# storage to that user: files written by earlier images, which ran as root,
# or under another PUID. Only files with another owner are touched, so this
# is quick after the first start. Started as another user already (compose
# `user:`, Kubernetes runAsUser), it runs as that user and changes nothing.
set -eu

if [ "$(id -u)" != 0 ]; then
  exec /app/hycanvas "$@"
fi

uid="${PUID:-1000}"
gid="${PGID:-1000}"
case "$uid$gid" in
  *[!0-9]*) echo "PUID and PGID must be numbers (got PUID=$uid PGID=$gid)." >&2; exit 1 ;;
esac

# The first-run setup writes its .env next to the binary.
chown "$uid:$gid" /app
if [ "${STORAGE_DRIVER:-local}" = local ]; then
  storage="${LOCAL_STORAGE_PATH:-/app/.data/storage}"
  mkdir -p "$storage"
  find "$storage" \( ! -user "$uid" -o ! -group "$gid" \) -exec chown -h "$uid:$gid" {} +
fi

export HOME=/app
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups /app/hycanvas "$@"
