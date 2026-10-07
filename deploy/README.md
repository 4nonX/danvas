# Installing danvas

This folder holds everything needed to run danvas on any Linux host with Docker, for example a home server. The image is built on the host from this repository, so no container registry is involved.

## Requirements

- Docker with Compose v2, `git`, `python3`, `openssl`, `curl`
- about 4 GB of RAM for the build, 2 GB of disk plus room for uploads

## Setup

```bash
git clone https://github.com/<you>/danvas.git
cd danvas/deploy
cp .env.example .env    # optional: adjust first, otherwise install.sh does it
./install.sh
```

`install.sh` generates the secrets in `.env` (`JWT_SECRET`, `AI_SECRET`, `POSTGRES_PASSWORD`), creates `data/`, mirrors the background-removal model (about 120 MB, every file checked against its SHA-256), builds the image (around 10 minutes the first time) and starts everything. Then open `APP_URL` in the browser and create an account; every account gets its own workspace, and you invite others from there. Without email delivery, set `AUTH_PASSWORD_SIGNUP_ENABLED=false` afterwards and run `docker compose up -d`, so strangers cannot sign up.

Main settings in `.env`:

| Setting | Meaning |
|---|---|
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
./update.sh            # current state of main
./update.sh v1.0.0     # a specific version (git tag)
```

The database is dumped to `backups/` first; then the image is rebuilt, the container recreated and the new version checked. Migrations run automatically on start.

## What to back up

- `data/pgdata` (or the dumps in `backups/`): the database with designs, accounts, brand kits and fonts
- `data/storage`: uploaded images, logos, masks
- `.env`: the secrets (without `AI_SECRET`, stored AI keys and MFA secrets cannot be decrypted)

`data/static-data` (the model files) can be restored at any time with `./fetch-bg-model.sh`.

## License

danvas is a modified version of HyCanvas by HyScaler, under the Elastic License 2.0: using and changing it for your own purposes is allowed, offering it to third parties as a hosted or managed service is not. See the repository [README](../README.md) and [LICENSE](../LICENSE). The background remover (`@imgly/background-removal`) is AGPL-3.0.
