# CLAUDE.md

Guidance for working in this repository. Keep it accurate — update it when the
facts below change.

## What this is

Self-hosted backend for the `entitybtw/hydra` fork of Hydra Launcher (and its
downstream fork `GulidovAlexander/hydra`). It replaces Hydra Cloud: accounts,
public profiles, library/playtime sync, cloud saves, reviews, and a small web
dashboard — all on the user's own server. Runs as a single container behind a
reverse proxy on a home LAN.

The launcher talks to this server when **Settings → Integrations → Self-Hosted
API** is enabled; the server fakes an always-active subscription so all cloud
features unlock without Hydra Cloud.

## Stack & layout

- **Runtime:** Node 20+/22, TypeScript, **Fastify 5**, **better-sqlite3** (a
  single SQLite file in WAL mode). No ORM — raw prepared statements.
- **Auth:** JWT (`jsonwebtoken`), bcrypt for passwords, optional WebAuthn
  passkeys (`@simplewebauthn/server`).
- `api/src/index.ts` — Fastify bootstrap, content-type parsers, route
  registration. `bodyLimit`/multipart limit = `MAX_SAVE_SIZE_MB`.
- `api/src/auth.ts` — token signing/verify. **`JWT_SECRET === process.env.API_TOKEN`.**
- `api/src/db.ts` — schema, idempotent migrations (`ALTER TABLE ... catch {}`),
  `enforceInitialAdmin()`. Data dirs are created here.
- `api/src/routes/*.ts` — one file per area. `web.ts` is the server-rendered
  dashboard/profile HTML (large; string templates, `h()` escapes HTML).
- Everything persists under `DATA_DIR` (default `/data`):
  `hydra.db`, `images/` (avatars/banners), `cloud-saves/` (content-addressed
  `<sha256>.blob`), `artifacts/` (legacy v1 saves).

## Running / dev

```bash
cd api
npm install
npm run dev          # tsx watch, needs DATA_DIR writable + env below
# or the whole thing:
docker compose up -d --build
```

`npm run build` = `tsc` → `dist/`. Container `CMD` runs `node dist/index.js`.

## Environment (see .env.example)

| Var | Required | Notes |
|---|---|---|
| `API_TOKEN` | **yes** | JWT signing key **and** the token clients present. Effectively an admin credential. |
| `INSTANCE_TOKEN` | **yes** | Guards `/admin/*` and `/auth/verify-instance`. If unset, those routes are open to anyone. |
| `CORS_ORIGINS` | strongly | Comma-separated. Empty ⇒ reflect any origin + allow credentials (unsafe). |
| `PUBLIC_URL`, `PORT`, `SESSION_TTL_DAYS`, `MAX_SAVE_SIZE_MB` | no | Defaults exist. |
| `INITIAL_ADMIN_USERNAME` | no | Empty ⇒ first registered user becomes admin. |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` | for passkeys | RP_ID = bare host, ORIGIN = full origin. Passkeys need HTTPS or localhost. |

## Critical gotchas (learned the hard way)

1. **Set `API_TOKEN === INSTANCE_TOKEN`.** The launcher's "Instance token" field
   is validated via `/auth/verify-instance` (checks `INSTANCE_TOKEN`), but the
   same stored value is later sent to `/web/launcher-gate`, which checks
   `API_TOKEN`. If the two differ, the launcher login window gets stuck on the
   token gate. Keeping them equal is the supported setup. Both are still
   mandatory (compose refuses to start without them).
2. **Rotating `API_TOKEN` invalidates every session token** (they are JWTs
   signed with it) → clients get `401 invalid token` and must log in again. Pick
   the value once and keep it stable.
3. **A user account lives on exactly one server's DB.** If you registered against
   `127.0.0.1` and then point the launcher at a domain, the account/token won't
   exist/verify there — register again on the target server.
4. **Uploaded filenames must be validated** before joining onto a data path — see
   `safeImageName()` in `routes/images.ts`. Any new endpoint that takes a
   filename/path segment and touches the filesystem must do the same (reject
   `/`, `\`, `..`, `\0`, non-basename). A path-traversal hole here previously let
   `/images/..%2F..%2Fetc%2Fpasswd` read arbitrary files.
5. **`web.ts` renders HTML by string concatenation.** Escape all user data with
   `h()`. The one deliberate exception is per-user `custom_css`, which is
   injected raw into a `<style>` — treat that as a known, accepted risk, not a
   pattern to copy.

## Security posture

Written for a trusted LAN. Before wider exposure: no rate limiting on
login/registration; plain HTTP leaks tokens (use the Caddy `https` profile or
your own TLS proxy); `API_TOKEN` = admin-equivalent (it can mint any session).
Keep `INSTANCE_TOKEN` set and `CORS_ORIGINS` explicit.

## Container & deploy

- `api/Dockerfile` is a **hardened multi-stage build**: compiler only in the
  build stage, runtime runs as **uid 1000**, app files stay root-owned, `tini`
  as PID 1, healthcheck on `/health`.
- `docker-compose.yml`: read-only rootfs, `cap_drop: ALL`,
  `no-new-privileges`, pids/cpu/mem limits, loopback bind by default
  (`BIND_ADDR`), optional Caddy `https` profile (`--profile https`) for
  passkeys/TLS. Both secrets are mandatory via `${VAR:?...}`.
- CI: `.github/workflows/docker-image.yml` builds `api/` and pushes to
  `ghcr.io/<owner>/hydra-selfhosted` on push to `main` and on `v*` tags. Only
  version tags get `:latest`; branch pushes get `:main` / `:sha-<commit>`.
- Data backups are handled externally (restic in the user's ansible), by
  snapshotting `hydra.db` (via `sqlite3 .backup`) plus the data dirs.

## Conventions

- **Code and commit messages in English.** Chat may be Russian.
- **No `Co-Authored-By: Claude` trailer** in commits — the user is sole author.
- Prefer small, semantic commits (`feat:`, `fix:`, `security:`, `ci:`).
- Migrations are additive and idempotent (guarded `ALTER TABLE ... catch {}`);
  never rewrite the schema block destructively.
- Match the existing route style: raw prepared statements, `(req as any).userId`
  from `requireAuth`, return plain objects (Fastify serializes).
