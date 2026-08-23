# hydra-selfhosted

Self-hosted backend for the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork of Hydra Launcher.

Run your own server for cloud saves, accounts, profiles, and game data — no Hydra Cloud subscription needed.

## Features

### Accounts & profiles

- **Accounts** — register and log in with username and password
- **Public profile** — shareable page at `/u/username` with playtime, library, and recent activity
- **Avatar & banner** — upload and crop a profile picture and banner image
- **Bio and display name** — editable from the launcher or web dashboard
- **Accent color & custom CSS** — personalize your profile appearance
- **Steam integration** — connect your Steam account to show Steam hours and Steam library on your profile

### Library & game management

- **Cloud saves** — game save backups stored on your own server, unlimited slots
- **Pin games** — pin any game to the top of your profile; pinned state syncs to the launcher sidebar
- **Favorite games** — mark games as favorites; heart icon shown on library cards
- **Playtime tracking** — accurate playtime recorded per game and shown on profile
- **Recent activity** — last played games shown per tab (Hydra / Steam) with configurable visibility and section order

### Web dashboard

Full web interface at `http://your-server:3000`:

- Edit profile: avatar (with crop editor), banner, display name, bio
- Browse your Hydra library and Steam library (if connected)
- Pin and unpin games, mark favorites
- Toggle visibility of library and recent activity sections
- Reorder sections (library above or below recent activity) per tab
- Change password

### Optional proxies

| Feature | What it does |
|---|---|
| Reviews | Read and write game reviews stored on your server |

### Big Picture support

The [entitybtw/hydra](https://github.com/entitybtw/hydra) fork's Big Picture mode fully supports self-hosted accounts:

- **Self-hosted profile in Big Picture** — library, stats, friends, and recent activity all load correctly even when the server does not return optional fields
- **Dual accounts** — if you also have an official Hydra account, both avatars appear in the Big Picture sidebar; clicking the small official avatar opens that profile without affecting your self-hosted session

### Other

- **No subscription required** — all features work without Hydra Cloud
- **Friendships API stub** — enough for the launcher to work without errors
- **Download sources** — the launcher routes `/download-sources` to the official Hydra API automatically

## Requirements

- Docker + Docker Compose

## Setup

```bash
git clone https://github.com/entitybtw/hydra-selfhosted.git
cd hydra-selfhosted
cp .env.example .env
# edit .env — set BOTH secrets (compose refuses to start otherwise):
#   API_TOKEN       — random string, handed to launcher clients
#   INSTANCE_TOKEN  — different random string, guards the /admin routes
# openssl rand -hex 32   generates a good value for each
docker compose up -d --build
```

The server runs on port 3000, bound to `127.0.0.1` by default (this machine
only). To let other devices on your LAN reach it, set `BIND_ADDR` in `.env` to
`0.0.0.0` or, better, to the server's LAN IP (e.g. `192.168.1.50`), then
`docker compose up -d`.

The container runs unprivileged (uid 1000), with a read-only root filesystem,
all Linux capabilities dropped, and `no-new-privileges` — only `./data` (a
named volume) is writable.

### Optional: HTTPS / passkeys

Passkeys (WebAuthn) require a secure context, so over a LAN IP they only work
behind TLS. An optional Caddy terminator is included:

```bash
docker compose --profile https up -d   # serves https on :8443
```

Set `SERVER_NAME` and the `WEBAUTHN_*` / `CORS_ORIGINS` values in `.env` to
your real host first.

## .env options

```env
API_TOKEN=your-random-secret        # required
PORT=3000
SESSION_TTL_DAYS=30                 # launcher session duration (default 30)
PUBLIC_URL=http://your-server:3000  # shown in the web dashboard
```

## Connecting to Hydra Launcher

1. Open the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork
2. **Settings → Integrations → Self-Hosted API**
3. Enter your server URL and `API_TOKEN`, click **Save**
4. A login window opens — register or sign in
5. The launcher connects automatically and syncs your library

## Data

Everything is stored in `./data/` — back this folder up to preserve all user data.

```
data/
  hydra.db        # SQLite database (users, games, achievements, artifacts)
  images/         # uploaded avatars and banners
  artifacts/      # cloud save archives
```

## Cloud save size limit

Cloud save uploads are capped at **50 MB** by default. To change the limit, set `MAX_SAVE_SIZE_MB` (in megabytes) in your `.env`:

```env
MAX_SAVE_SIZE_MB=100
```

Then restart the API (`docker compose up -d`). No code changes needed.

## Updating

```bash
git fetch origin && git checkout origin/main -- api/ docker-compose.yml && docker compose up --build -d
```

Your `.env` and `data/` are never touched by updates.

## Security notes

This backend was written for a trusted LAN. Before exposing it more widely, be
aware of the following:

- **`INSTANCE_TOKEN` is mandatory.** The `/admin/*` routes (list / create /
  edit / delete any user, including resetting passwords) are protected *only*
  by this token. If it is unset, those routes are reachable with no
  credentials at all — anyone who can reach the port can take over any account.
  The bundled `docker-compose.yml` refuses to start until it is set.
- **`API_TOKEN` is effectively an admin credential.** It doubles as the JWT
  signing key, so whoever holds it can mint a valid session for any account.
  Hand it only to devices you trust, and keep it distinct from `INSTANCE_TOKEN`.
- **Set `CORS_ORIGINS`.** Left empty, the API reflects any `Origin` and allows
  credentials, so any website you visit could call the API from your browser.
  List your real origins (e.g. `http://192.168.1.50:3000`).
- **No transport encryption by default.** Over plain HTTP on a LAN, tokens and
  passwords cross the network in cleartext. Use the `https` profile (above) or
  put the API behind your own reverse proxy for anything beyond a home LAN.
- **No rate limiting** on `/auth/login` or registration — fine on a private
  network, not for the open internet.

## Running from the published image

Once the `Build & publish API image` GitHub Action has run, a ready-made image
is available and you can skip building locally:

```bash
docker pull ghcr.io/GulidovAlexander/hydra-selfhosted:latest
```

To use it in `docker-compose.yml`, replace the `build:` block of the `api`
service with:

```yaml
    image: ghcr.io/GulidovAlexander/hydra-selfhosted:latest
```

Make the image public in your repo's **Packages** settings if you want others
to pull it without authenticating.
