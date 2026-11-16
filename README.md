# PennyVoice

React + TypeScript PWA with a Spring Boot 4.1 / PostgreSQL backend.

- **Home:** today’s recorded spending and a speak/type → Send → review → Save flow.
- **Analysis:** monthly spending, budget, weekly trend, largest expenses, and outstanding balances.
- **Activity:** searchable expenses, debts, and repayments.
- **Settings:** account, speech language, sync, and private backup/import.

Entries commit to IndexedDB first. Backend outages do not block local ledger activity. Browser speech recognition can still require internet.

## Run locally

Requirements: Node 22.18+, Java 21+, Docker running. The Maven wrapper is included.

```sh
npm ci
```

The local `.env` was updated during implementation. For a fresh checkout, create it once:

```sh
python3 - <<'PY'
from pathlib import Path
import secrets, base64
with Path('.env').open('x') as file:
    file.write('DATABASE_PASSWORD=' + secrets.token_urlsafe(32) + '\n')
    file.write('PENNYVOICE_JWT_SECRET=' + base64.b64encode(secrets.token_bytes(32)).decode() + '\n')
    file.write('COOKIE_SECURE=false\n')
Path('.env').chmod(0o600)
PY
```

This refuses to overwrite an existing `.env`. Keep the JWT key private and stable across restarts; changing it invalidates access tokens. `COOKIE_SECURE=false` is for plain HTTP localhost development only. The server defaults to Secure cookies; set `COOKIE_SECURE=true` for HTTPS hosting or tunnel testing.

Start Postgres:

```sh
docker compose up -d postgres
```

Start the backend from the project root:

```sh
set -a
source .env
set +a
./backend/mvnw -f backend/pom.xml spring-boot:run
```

In another terminal:

```sh
npm run dev
```

Open Vite’s printed URL. `/api` proxies to `http://127.0.0.1:8080`. Backend and database bind to loopback by default.

Use **Settings → Sign in / sign up** for an account. Device-only use does not require an account.

## Build and package

```sh
npm run build
./backend/mvnw -f backend/pom.xml verify
```

Maven bundles the current `dist` directory into the backend jar, so build the frontend first. Stop an existing packaged server before replacing its jar.

```sh
set -a
source .env
set +a
java -jar backend/target/pennyvoice-0.0.1-SNAPSHOT.jar
```

Open http://127.0.0.1:8080. Both frontend and API share one origin. For frontend preview against an already-running backend:

```sh
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Configuration: `DATABASE_URL` is a JDBC URL (default `jdbc:postgresql://localhost:5432/pennyvoice`); `DATABASE_USERNAME` defaults to `pennyvoice`; `DATABASE_PASSWORD` is required. `PORT` defaults to 8080 and `SERVER_ADDRESS` to 127.0.0.1. `PENNYVOICE_JWT_SECRET` must be base64 of at least 32 random bytes. The old shared sync key is no longer used.

## Authentication

Spring Security verifies HS256 JWT signatures, issuer, audience, subject, and expiry. Passwords use BCrypt (cost 12); passwords require 12 characters and at most 72 UTF-8 bytes. Emails are normalized and unique. No password or JWT is persisted by the frontend.

- Access JWT: 15-minute lifetime, kept in page memory, sent explicitly through `Authorization: Bearer …`.
- Refresh session: 30-day absolute lifetime, HttpOnly / SameSite=Strict cookie, Secure by default. Only a SHA-256 token hash is stored in Postgres.
- Refresh rotation: a 30-second retry window returns the same successor cookie if a rotation response was lost. Reuse outside that window or after the successor rotates is rejected.
- Refresh requests are serialized across tabs where Web Locks is available. Account changes invalidate stale client results.
- Auth mutations require Spring CSRF tokens. `GET /api/auth/csrf` returns the masked token used in `X-XSRF-TOKEN`; its cookie is HttpOnly. Ledger writes require explicit bearer headers and do not authenticate through cookies.
- Login/signup have a bounded per-process IP throttle, default 20 attempts/minute. It is not a distributed limiter; a reverse proxy must be configured appropriately before wider deployment.
- Logout revokes the refresh family and clears local authentication. Previously issued JWTs remain valid until their short expiry. If offline, local logout takes effect immediately and server logout is retried on reconnection/reopening; pending ledger entries are retained.

Endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/csrf` | CSRF token |
| `POST /api/auth/register` | Create account; email/password JSON |
| `POST /api/auth/login` | Sign in; email/password JSON |
| `POST /api/auth/refresh` | Rotate refresh cookie and issue JWT |
| `POST /api/auth/logout` | Revoke refresh family; clear cookie |
| `GET /api/entries` | Current JWT account’s history |
| `PUT /api/entries/{uuid}` | Validate and append; identical retries are idempotent |

Every ledger query and repayment balance check is scoped to the verified JWT subject. An entry’s owner cannot be supplied in request JSON. Account A cannot retrieve or consume account B’s balances, even when entry UUIDs match. Postgres transactions serialize repayment validation within each account.

Authentication provides accounts and API authorization, not encryption of browser data. Someone with access to device/browser storage may still inspect cached records. Email verification, password recovery, MFA, and remote immediate JWT revocation are not implemented.

References: [Spring JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html), [password storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html), [CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html).

## Existing data and offline ownership

The original browser database (`pennyvoice`) remains the device-only ledger. Each account has its own IndexedDB database (`pennyvoice-user-{uuid}`), including its budget, pending uploads, and language preference. Account switching cannot redirect an existing upload into another account. Signing out hides account records but never deletes pending entries or cached history.

Signing in does **not** automatically claim/upload the device-only ledger. Choose **Settings → Import device-only entries → Copy entries** to copy it into the current account and queue uploads. Originals remain intact. Backups can also be imported explicitly.

Migration V2 preserves earlier unowned server rows, quarantined from all accounts. No first signup automatically claims them. If those records are still in the original browser ledger, use the explicit copy flow; otherwise an administrator must identify the owner and migrate them deliberately. V3 adds refresh-family and retry metadata. No migrations delete legacy financial records.

A cached account hint (ID/email, no credential) allows returning to that account’s local ledger during an outage. It does not authorize any API request. Successful online refresh verifies the account before syncing. Account hints are removed on logout. No always-running background service is assumed: sync occurs after account entry saves, sign-in, reconnection while open, or **Sync now**.

All local history is retained for now, including older unsynced entries and outstanding debts. Month-based pruning, history pagination, saved-entry edits/deletes, and conflict resolution are deferred. A conflict pauses sync visibly; it never deletes local records.

Amounts use integer paise. Debt/repayment entries are excluded from spending totals; receivable and payable balances remain separate. Today uses the device’s local calendar date and refreshes across midnight. Monthly comparisons use recorded whole-month totals, which can be incomplete. Language and budget preferences are local, not server-synced. JSON ledger backups exclude those preferences and contain private financial entries.

## Device / PWA testing

For HTTPS phone access, run the packaged server with `COOKIE_SECURE=true`, then optionally run your own temporary tunnel:

```sh
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8080
```

No tunnel, deployment, or DNS change was made automatically. The temporary app shell is reachable to anyone with the URL; private data still requires authentication. Each new hostname is a separate browser-storage origin: export before changing URLs.

Plain HTTP on a LAN IP is not equivalent to localhost and may not satisfy browser requirements. Safari iPhone: Share → Add to Home Screen. Chrome Android: Install app/Add to Home screen. Visit and refresh the production app online before offline testing so the service worker controls the page and caches assets. API/auth responses are never service-worker cached. Development mode does not register a worker.

Earlier speech observations and six test phrases are in [the speech spike checklist](docs/speech-spike.md). User-reported Safari/Chrome speech success remains separate from automated recognizer simulations.

## Verification

```sh
npm test
npm run lint
npm run build
./backend/mvnw -f backend/pom.xml verify
```

Frontend checks cover transcript accumulation, money/ledger rules, the six English phrases, spending analysis, atomic IndexedDB saves, account-specific caches/budgets, memory-only JWT handling, offline/lost-ack retries, account-bound sync, offline logout, and reconnection during an in-flight refresh failure.

Backend tests use throwaway Testcontainers Postgres, not the development database. They cover CSRF, password hashing, login, refresh-cookie rotation and its retry window, logout/rotation races, expired/tampered JWTs, cross-account and legacy-row isolation, validation, idempotency, concurrent repayments, and the IP throttle.

Browser checks use an isolated headless Chromium profile and a disposable database (removed after testing). The network test explicitly emits an online event after restoring simulated connectivity. They exercise the compact Home, Analysis budget placement, real signup/login, explicit guest import, JWT sync, cookie flags, reload/session restore, account switching, offline saves/reconnection, and narrow layouts. Speech events are simulated; these checks do not prove physical microphone accuracy or Safari/iPhone behavior.

No hosting has been published. Receipt uploads, bank integrations, AI extraction, notifications/reminders, and shared multi-user ledgers remain out of scope.
