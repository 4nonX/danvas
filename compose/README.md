# Deploy danvas with Docker Compose

Two files are all you need:

- [`compose.yml`](compose.yml): the complete stack, danvas and its Postgres database, using the published image `ghcr.io/4nonx/danvas` (amd64 and arm64)
- [`.env.example`](.env.example): every setting, explained; save it as `.env` next to `compose.yml`

Three settings are required: `JWT_SECRET`, `AI_SECRET` and `POSTGRES_PASSWORD`. Fill each with a random value, for example from `openssl rand -hex 32` (without openssl: `head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'`). If one is missing, the deploy stops and says which. Keep a copy of your `.env`: without `AI_SECRET`, stored AI keys and MFA secrets cannot be decrypted.

To reach danvas from other machines at `http://<server>:8005`, set `BIND_ADDR=0.0.0.0`. Behind a reverse proxy with HTTPS, keep `127.0.0.1` and set `APP_URL=https://your.domain` and `COOKIE_SECURE=true`.

## Dockge

1. **+ Compose**, name the stack `danvas`.
2. Paste [`compose.yml`](compose.yml) into the compose editor.
3. Paste [`.env.example`](.env.example) into the `.env` editor below it and fill in the three secrets (and `BIND_ADDR`, `APP_URL` as above).
4. **Deploy**. Open danvas and create an account.

The database and uploads are kept in `data/` inside the stack's folder (e.g. `/opt/stacks/danvas/data`).

## Arcane

1. **Projects**, **Create Project**, name it `danvas`.
2. Paste [`compose.yml`](compose.yml) as the compose file and [`.env.example`](.env.example) as its `.env`, then fill in the three secrets.
3. **Deploy**.

## Portainer

1. **Stacks**, **Add stack**, name it `danvas`, **Web editor**, paste [`compose.yml`](compose.yml).
2. Under **Environment variables**, **Load variables from .env file** with your filled-in copy of [`.env.example`](.env.example) (or add `JWT_SECRET`, `AI_SECRET` and `POSTGRES_PASSWORD` by hand).
3. **Deploy the stack**.

## Command line

```bash
mkdir danvas && cd danvas
curl -fsSLO https://raw.githubusercontent.com/4nonX/danvas/main/compose/compose.yml
curl -fsSL https://raw.githubusercontent.com/4nonX/danvas/main/compose/.env.example -o .env
for k in JWT_SECRET AI_SECRET POSTGRES_PASSWORD; do sed -i "s|^$k=$|$k=$(openssl rand -hex 32)|" .env; done
docker compose up -d
```

Or let [`deploy/install.sh`](../deploy/README.md) do these steps, including the secrets.

## Updates and backups

`DANVAS_VERSION` in `.env` chooses the release (empty: the latest). To update, set the new release (or keep it empty), then pull and redeploy: in Dockge and Arcane the update button, on the command line `docker compose pull && docker compose up -d`. The database migrates on start. Release notes: [CHANGELOG.md](../CHANGELOG.md).

Back up `data/` (the database in `data/pgdata`, uploads in `data/storage`) and your `.env`.

Docker Compose 2.24 or newer is needed (Dockge, Arcane and current Docker releases have it). More settings, HTTPS examples and the full image reference: [deploy/README.md](../deploy/README.md).
