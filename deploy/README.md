# Installing danvas

danvas runs on any Linux host with Docker, for example a home server. Every release is published as a ready-made image for amd64 and arm64 at `ghcr.io/4nonx/danvas`, so an install pulls it in a minute instead of building it. The image is complete: the background remover's model ships inside it and is served by your instance, so it works without any third-party CDN, also on hosts without internet access.

## Requirements

- Docker with Compose v2, `curl`, `openssl`
- 1 GB of RAM, 2 GB of disk plus room for uploads

## Setup

In an empty folder:

```bash
mkdir danvas && cd danvas
curl -fsSL https://raw.githubusercontent.com/4nonX/danvas/main/deploy/install.sh -o install.sh
bash install.sh
```

`install.sh` looks up the latest release, fetches `compose.yaml`, `.env.example` and `update.sh` for it, creates `.env` with generated secrets (`JWT_SECRET`, `AI_SECRET`, `POSTGRES_PASSWORD`), pins the release in `.env` (`DANVAS_VERSION`), pulls the images and starts everything. Then open `APP_URL` in the browser and create an account; every account gets its own workspace, and you invite others from there. Without email delivery, set `AUTH_PASSWORD_SIGNUP_ENABLED=false` afterwards and run `docker compose up -d`, so strangers cannot sign up.

### Without the script

The same by hand, with the release you want:

```bash
mkdir danvas && cd danvas
v=v0.1.6
curl -fsSLO https://raw.githubusercontent.com/4nonX/danvas/$v/deploy/compose.yaml
curl -fsSL https://raw.githubusercontent.com/4nonX/danvas/$v/deploy/.env.example -o .env
for k in JWT_SECRET AI_SECRET POSTGRES_PASSWORD; do sed -i "s|^$k=$|$k=$(openssl rand -hex 32)|" .env; done
sed -i "s|^DANVAS_VERSION=.*|DANVAS_VERSION=$v|" .env
mkdir -p data/storage data/pgdata
docker compose up -d
```

### From a clone of the repository

```bash
git clone https://github.com/4nonX/danvas.git
cd danvas/deploy
./install.sh            # pulls the image of the clone's version
./install.sh --build    # builds it from the clone instead (about 10 minutes, 4 GB of RAM)
```

When the image of the clone's version cannot be pulled, `install.sh` builds it from the clone. Building is recorded in `.env` (`COMPOSE_FILE=compose.yaml:compose.build.yaml`), so updates keep building.

### Dockge, Arcane, Portainer, Unraid, Synology

The stack is self-contained: [`compose/compose.yml`](../compose/compose.yml) and [`compose/.env.example`](../compose/.env.example) (identical to `compose.yaml` and `.env.example` here). Step-by-step for Dockge, Arcane and Portainer: [`compose/README.md`](../compose/README.md). Unraid (Docker Compose Manager plugin) and Synology (Container Manager, Project) work the same way. The image carries its name, description, icon and web-UI link, so dashboards show it with the danvas icon and an "open" button.

## Image reference

| | |
|---|---|
| Image | `ghcr.io/4nonx/danvas` |
| Tags | `v0.1.6` / `0.1.6` (a release), `0.1` (newest 0.1.x), `latest` (newest release), `main` (newest state of main, for testing) |
| Platforms | `linux/amd64`, `linux/arm64` (Raspberry Pi 4/5, Apple silicon, ARM servers) |
| Port | `8005` (the web app, its API and the realtime connection) |
| Volume | `/app/.data/storage`: uploads, exports, snapshots (with the default local storage) |
| User | runs as `PUID`:`PGID` (default `1000:1000`), not root; on start, files in the storage volume that belong to someone else are handed to that user, which also covers installs from images that ran as root |
| Health check | `GET /healthz` answers `{"status":"ok","version":"v0.1.6"}`; Docker shows the container as healthy |
| Database | PostgreSQL (`compose.yaml` brings Postgres 16, as do all danvas setups); migrations run on every start |

The variables the image itself reads (everything else is in [`.env.example`](.env.example)):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (none) | `postgresql://user:password@host:5432/danvas`; without it the first-run setup wizard starts |
| `JWT_SECRET`, `AI_SECRET` | (none) | secrets for sign-in and stored AI keys; `openssl rand -hex 32` each |
| `APP_URL` | | the address users open in the browser |
| `PUID`, `PGID` | `1000` | the user and group the app runs as |
| `TZ` | `UTC` | time zone, e.g. `Europe/Berlin` |
| `PORT` | `8005` | the port inside the container |
| `STORAGE_DRIVER` | `local` | `local` (the volume) or `s3` for S3-compatible object storage |

With a Postgres you already run, a single container is enough:

```bash
docker run -d --name danvas --restart unless-stopped -p 8005:8005 \
  -e DATABASE_URL=postgresql://danvas:secret@db.example.org:5432/danvas \
  -e JWT_SECRET=$(openssl rand -hex 32) -e AI_SECRET=$(openssl rand -hex 32) \
  -e APP_URL=http://localhost:8005 -e COOKIE_SECURE=false \
  -v danvas-storage:/app/.data/storage \
  ghcr.io/4nonx/danvas:latest
```

Keep the generated `JWT_SECRET` and `AI_SECRET` (`docker inspect danvas`): a new `AI_SECRET` cannot decrypt stored AI keys and MFA secrets.

## Settings

Main settings in `.env`:

| Setting | Meaning |
|---|---|
| `DANVAS_VERSION` | the release to run, e.g. `v0.1.6` (set by `install.sh` and `update.sh`) |
| `APP_URL` | the address in the browser, e.g. `https://canvas.example.org` |
| `COOKIE_SECURE` | `true` behind HTTPS, `false` for plain http (otherwise sign-in fails) |
| `BIND_ADDR`, `APP_PORT` | default `127.0.0.1:8005` for a reverse proxy; `0.0.0.0` for direct LAN access |
| `INSTANCE_NAME` | name shown in the interface instead of "danvas" |
| `INSTANCE_ACCENT` | accent color of the interface as `#rrggbb`; the full color scale, the gradient and the favicon are derived from it |
| `INSTANCE_LOCALE` | language for everyone who has not picked one, e.g. `de` (empty: the browser's language) |
| `BUILTIN_TEMPLATES` | `off` hides the built-in starter templates |
| `BRAND_STARTER_KIT` | `hycanvas` seeds HyCanvas's own brand kit into new workspaces (off by default) |
| `OIDC_*` | optional single sign-on (Authentik, Keycloak, Google, ...) |

Changes to `.env` take effect after `docker compose up -d`.

## Reverse proxy (HTTPS)

Example with Caddy, which obtains the certificate itself:

```
canvas.example.org {
    reverse_proxy 127.0.0.1:8005
}
```

Then set `APP_URL=https://canvas.example.org` and `COOKIE_SECURE=true` in `.env`. The proxy must pass WebSockets through (Caddy and Traefik do by default) and allow large uploads.

## Updates

```bash
./update.sh            # the latest release
./update.sh v0.1.7     # a specific release
```

The database is dumped to `backups/` first; then the new image is pulled (or, when building, the clone is switched to the release tag and the image rebuilt), the container recreated and the new version checked. Migrations run automatically on start. If the new image cannot be pulled, nothing changes and the instance keeps running the previous release. Release notes: [CHANGELOG.md](../CHANGELOG.md).

The newest state of `main` is published as well (`DANVAS_VERSION=main`, then `docker compose pull && docker compose up -d`); it is built and checked the same way as a release but has not been released, so use it for testing, not for an instance you depend on.

The stack folder may live inside another git repository, such as a GitOps repository: `update.sh` only switches tags and builds from source in a clone of danvas itself, never in a repository around the stack.

Installs from before the published images built the image on the host and mirrored the model into `data/static-data`. `./update.sh` moves them to the published image; `data/static-data` is no longer used and can be deleted.

## What to back up

- `data/pgdata` (or the dumps in `backups/`): the database with designs, accounts, brand kits and fonts
- `data/storage`: uploaded images, logos, masks
- `.env`: the secrets (without `AI_SECRET`, stored AI keys and MFA secrets cannot be decrypted)

## License

danvas is a modified version of HyCanvas by HyScaler, under the Elastic License 2.0: using and changing it for your own purposes is allowed, offering it to third parties as a hosted or managed service is not. See the repository [README](../README.md) and [LICENSE](../LICENSE). The background remover (`@imgly/background-removal`) is AGPL-3.0; its model (ISNET) and the ONNX runtime it uses are MIT. The image carries their license texts in `/app/static-data/bg-removal/`.
