# CLAUDE.md

This file is the working guide for coding agents in the Spottex repository. `README.md` is the authoritative operator documentation; keep it synchronized when runtime, environment, migration, backup, or deployment behavior changes.

## Project overview

Spottex is a Czech-language full-stack solar-energy optimization platform built with Next.js 15, React 19, TypeScript, PostgreSQL 16, and Prisma 6. It contains the public website, authentication, user account, admin, commerce, consultations, analytics, and the server-side energy integration layer in one application.

`legacy-flutter-app/` is a read-only snapshot of the existing online Flutter application. It is a visual/data-contract reference only, is ignored by Docker, and must not become a Next.js route or build input.

`backend-customer-journey/` is a stale linked worktree of someone else's backend clone (`/home/anna/…`), gitignored here and not part of any build or deployment. Its thirteen "uncommitted" files look like unsaved work but are not: they were snapshotted into backend commit `fa45538` on 2026-08-10 and pushed, and the worktree has since fallen behind the LightGBM cutover. Do not treat it as a source of truth, do not deploy from it, and do not spend time reconciling it — the backend that actually runs is a separate clone, see below.

The existing production Spottex and GridLink energy services are external dependencies. This repository must not modify, restart, redeploy, or assume ownership of them. The new platform calls them through server-side adapters; default local endpoints are ports `2086` and `45992`.

On this development host the energy backend runs from a bind mount of its own clone rather than a baked image, so the running code is exactly that working tree — there is no image drift to chase. The two-step SolaX onboarding (`/discover_plants`, `/register_selected`) exists only on the backend branch `feature/customer-journey`; neither `dev` nor `prod` has those endpoints, and that branch is an unreviewed work-in-progress checkpoint. Any host that needs plant onboarding has to run that branch deliberately.

## Primary commands

```bash
npm run dev          # Next.js dev server on 127.0.0.1:3004
npm run build        # Production Next.js build
npm run start        # Start the production build on port 3004
npm run lint         # ESLint; zero warnings allowed
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright Chromium end-to-end tests
npm run preflight    # lint + typecheck + unit tests + build

npm run db:generate  # Generate Prisma client
npm run db:migrate -- --name change-name  # Create a development migration
npm run db:deploy    # Apply committed migrations
npm run db:seed      # Idempotent base seed and refreshed DEMO energy data
```

There is no Vite server, `npm run preview`, Oxlint, or `dist/` production artifact.

## Local runtime

The fastest complete environment is:

```bash
docker compose -f deploy/compose.dev.yml up --build
docker compose -f deploy/compose.dev.yml exec app npm run db:seed
```

The first command starts PostgreSQL, Mailpit, Next.js, and the 30-second background-job poller. It generates Prisma and applies migrations, but deliberately does not seed.

The database service is named `web-db`, not `db`. `deploy/compose.full.yml` merges this file with the energy backend's own compose file via `include`, and the backend also defines a `db` service; Compose deep-merges same-named services, so a generic name silently collapses both PostgreSQL instances into one container and points Prisma migrations at the backend database.

`deploy/compose.full.yml` runs both halves of the system as a single project. It includes the backend repository's compose file rather than copying it, so that repository stays the owner of its services; override the location with `SPOTTEX_BACKEND_COMPOSE`. In the merged project the app reaches the backend at `http://web:2086` and `db:5432` over the project network. Never start it alongside a separately running `spottex_backend` project — both would bind `2086`/`5434` and both would drive `control_broadcaster` and the inverter workers against the same real inverters.

`deploy/compose.dev-build.yml` is an override that swaps `app` and `analysis-worker` for a production build of the same `Dockerfile` production uses, because the dev server is too slow on a shared remote host. It drops the source bind mount, so hot reload is gone and every change needs a rebuild, and it adds an `app-migrate` one-shot to replace the migrations the dev start command used to run. The build image always runs `NODE_ENV=production` and therefore enforces the production environment contract, so the override supplies what this host needs — `PAYMENT_PROVIDER=FREE`, `DEV_AUTO_VERIFY_EMAIL=false`, `TRUST_PROXY_HEADERS=true`, `ALLOW_INSECURE_LEGACY_HTTP=true` because the energy backend answers on the project network without TLS, and — because that host's domain is not set up with a mail provider and a verification link could never arrive — `ALLOW_AUTO_VERIFIED_ACCOUNTS=true` with `ALLOW_INSECURE_SMTP=true` so accounts are created already verified and every message is captured by Mailpit. Any `RESEND_API_KEY` is blanked so nothing is sent for real. Those three overrides make the host trust-on-sight: anyone who reaches it signs in as any address they type. They are acceptable only on an internal development machine, production Compose never sets them, `validateProductionEnvironment` rejects each without its explicit flag, and every relaxed one warns at startup.

Local ports:

- application: `127.0.0.1:3004`
- PostgreSQL: `127.0.0.1:5435`
- Mailpit UI: `127.0.0.1:8026`
- Mailpit SMTP from host: `127.0.0.1:1026`
- Mailpit SMTP from containers: `mailpit:1025`

For host development:

```bash
cp .env.example .env
docker compose -f deploy/compose.dev.yml up -d db mailpit
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Replace the placeholder auth, encryption, and job secrets first. Host development does not automatically run the `jobs` service against the host Next.js process; call `/api/internal/jobs/run` with the bearer token or use the full Compose stack when testing email delivery and expired consultation holds.

## Architecture map

### Routes

- `src/app/(marketing)` — landing page, blog, consultations, and legal pages.
- `src/app/(auth)` — Czech login, registration, verification, and password reset UI plus compatibility aliases.
- `src/app/(user)/app` — authenticated user dashboard, subscription, payments, invoices, cart, and profile.
- `src/app/admin` — `ADMIN`-only platform administration.
- `src/app/(payment)` — provider return and development mock payment pages.
- `src/app/api` — public, user, admin, provider callback, analytics, and internal job handlers.

Route groups do not affect public URLs. User and admin pages must remain behind their protected layouts and API routes must independently enforce authorization.

### UI

- `src/App.jsx` and `src/index.css` preserve the public landing-page visual language.
- `src/app/globals.css` defines the shared application tokens and utility components.
- `src/components/app-shell` owns navigation and common page primitives for user/admin areas.
- Prefer `app-card`, `app-input`, `app-button`, `PageHeader`, `StatusBadge`, and existing components over introducing a parallel admin design system.
- UI copy is Czech unless a technical/provider identifier must stay in English.

### Authentication and authorization

- Auth.js credentials provider is configured in `src/auth.ts`.
- Session strategy is JWT; roles are `USER` and `ADMIN`.
- Server pages/layouts use `requireUser` or `requireAdmin` from `src/lib/auth/guards.ts`.
- API handlers use `apiUser` or `apiAdmin` and must still validate entity ownership.
- Disabled or unverified users cannot authenticate.
- Never trust client-provided user IDs, role values, totals, prices, ownership, or provider status.

### Database

`prisma/schema.prisma` uses PostgreSQL multi-schema support:

- `general` — users, sites, inverters, measurements, schedules, and commands
- `auth` — verification and password-reset tokens
- `payment` — products, carts, payments, subscriptions, and invoices
- `content` — founders, references, site settings, and blog posts
- `analytics` — consent records and analytics events
- `consultation` — slots, bookings, and host calendar credentials
- `jobs` — scheduled jobs, email outbox, and audit log

Use the singleton from `src/lib/prisma.ts`. Do not instantiate ad-hoc Prisma clients in application code.

Every schema change requires a committed migration. Use `npm run db:migrate -- --name ...` locally and `npm run db:deploy` in shared/production environments. Do not use `prisma db push` against shared or production databases.

Production deliberately separates database authority:

- `DATABASE_ADMIN_URL` uses the owner role and is available only to the one-shot `migrate` service.
- Runtime `DATABASE_URL` uses the limited app role with schema usage plus CRUD/sequence grants required by Prisma.
- `db_backup` uses a separate read-only backup role.
- `scripts/grant-db-role.ts` creates/rotates the app and backup roles and reapplies current/default privileges after migrations or restore.

Do not expose the owner URL/password or backup credentials to the application container, and do not change production migrations to run under the limited app role.

The seed:

- upserts the configured admin,
- upserts the inverter-control product and site settings,
- upserts a DEMO site/inverter,
- replaces only that DEMO inverter's generated measurement, interval, and schedule cache.

It does not wipe real users or provider data, but it must still be run intentionally in production because it attaches DEMO data to the seed admin. Every run rehashes `ADMIN_SEED_PASSWORD`, writes it to the admin, and increments `authVersion`, invalidating that admin's existing sessions. Production rejects missing or placeholder seed passwords and requires 14 characters through 72 UTF-8 bytes (bcrypt's input limit); treat a repeated seed as an intentional credential rotation.

### Commerce

`src/lib/commerce` owns cart totals, payment-provider selection, subscription activation, invoice creation, and PROMO behavior.

- Store money in minor units, never floating-point major currency units.
- Recalculate totals server-side.
- Payment finalization must remain idempotent and transactional.
- `MOCK` is development-only; its completion route rejects production use.
- GoPay callbacks must be reconciled against the provider before business state changes.
- Seller/legal snapshots on invoices must not silently change after issue.
- An invoice is currently a database snapshot rendered as HTML. “Uložit PDF” invokes `window.print()` and the browser print dialog; there is no server-generated or server-archived PDF.

The active production mode is `PAYMENT_PROVIDER=FREE`; services are activated for zero cost without a payment gateway or expiring trial. The dormant GoPay path is not a product commitment and must not be presented as active. Stripe or another future payment provider requires a separate product decision, implementation, and E2E verification.

### Consultations

`src/lib/consultation` and consultation APIs implement slot availability, transactional holds, e-mail verification, confirmation, cancellation/rescheduling, reminders, Google Calendar, and Meet links.

- Store instants in UTC and render using `Europe/Prague`.
- Preserve transactional slot locking and the invariant that only one active booking owns a slot.
- Expired holds are released by the internal job runner.
- Manage and verification tokens are stored as hashes, never raw values.
- Google access/refresh tokens are encrypted before persistence.
- External calendar/email failures must not corrupt a confirmed database reservation.

### Email and jobs

Application workflows enqueue messages through `src/lib/email.ts`; they do not deliver synchronously. Queued text/HTML bodies are AES-GCM encrypted at rest, decrypted only for delivery, and redacted after a successful send. The worker also recovers stale `RUNNING` rows for retry. The job runner calls `/api/internal/jobs/run` every 30 seconds and processes `jobs.email_outbox`, expired consultation holds/subscriptions, and retention/anonymization work.

Resend takes precedence when `RESEND_API_KEY` exists; otherwise the `emailjs` `SMTPClient` fallback is used. This repository does not use Nodemailer. Local e-mail must be inspected in Mailpit.

### Energy adapter

`src/lib/energy` is the anti-corruption layer between Spottex UI/domain data and external energy services.

- `types.ts` defines internal and external contracts.
- `legacy-client.ts` is the only low-level client for the current legacy Spottex API.
- `mapping.ts` normalizes legacy payloads.
- `service.ts` checks ownership, manages encrypted tokens, persists snapshots, and falls back to cache safely.
- `authorization.ts` contains ownership/command assertions.

External credentials and refresh tokens must never reach client components, logs, analytics properties, API error bodies, or audit metadata. Persist them only through AES-256-GCM helpers in `src/lib/crypto.ts`. `APP_ENCRYPTION_KEY` must decode to exactly 32 bytes.

`GRIDLINK` is currently a prepared provider/model and environment contract, not a complete active adapter. Do not claim it is live without implementing and testing its client/mapping/service path.

Market prices are copied from the existing backend's
`control.ote_prices_15min` through `src/lib/pricing/backend-market-source.ts`.
`SPOTTEX_BACKEND_DATABASE_URL` must be a dedicated read-only role; never give
the web application the backend owner/runtime credentials. Preserve the
`prediction` flag so confirmed prices and future forecasts remain auditable.

Published catalog facts come from the authenticated Costs API. Spottex may
materialize only explicitly mapped, source-backed fields into its local
versioned tariff schema. Missing purchase, distribution, tax, validity, or
source facts must remain a draft/blocker and must never be replaced by a
plausible default.

Production legacy energy traffic must use HTTPS, normally through an internal TLS-terminating reverse proxy. Never send legacy credentials directly to plaintext port `2086`. Runtime validation rejects an HTTP legacy URL in production unless the explicit emergency override `ALLOW_INSECURE_LEGACY_HTTP=true` is set; do not make that override the deployment default.

### Content and analytics

- Public founders, references, and posts must always filter `published: true`.
- Admin content mutations go through authenticated admin APIs and write audit records.
- Internal events accept only the allowlist defined by the analytics API.
- Optional analytics and Meta Pixel behavior must remain consent-gated.
- The current Meta Pixel ID is managed through `SiteSettings` in `/admin/metriky`; `META_PIXEL_ID` and `META_CONVERSIONS_API_TOKEN` env entries are reserved for future server-side/CAPI work.
- Production public media URLs must be HTTPS and their host must be included in the comma-separated `PUBLIC_MEDIA_HOSTS` allowlist.
- The internal job applies configurable retention to analytics, consent, audit, consultation PII, and successful/failed email-outbox data. Keep the retention env values aligned with the approved privacy/accounting policy; values must be positive integers no greater than 3650 days.

## Environment rules

`.env.example` documents local defaults. `deploy/env.production.example` is the complete production template and should be copied to repository-root `.env.production`. Never commit `.env`, `.env.local`, or `.env.production`.

Define each secret in exactly one environment file. Development Compose is normally started with two `--env-file` flags, and the later one wins, so a value present in both files silently depends on flag order and on when each container was last recreated. `APP_ENCRYPTION_KEY` sat in both with different values: containers recreated at different times encrypted and decrypted with different keys, and an uploaded invoice failed with `Unsupported state or unable to authenticate data` because the service that wrote it and the service that read it disagreed. The same hazard reaches energy tokens, e-mail bodies, and calendar credentials. It lives in `Secrets/spottex.development.env` only; `.env` carries a comment where it used to be.

Production essentials:

- `APP_URL`, `AUTH_URL`
- `AUTH_SECRET`
- `APP_ENCRYPTION_KEY`
- `INTERNAL_JOB_TOKEN`
- `DATABASE_ADMIN_URL` for migrations and limited `DATABASE_URL` for the app
- `EMAIL_FROM` and either Resend or SMTP configuration
- owner/app/backup PostgreSQL role names and distinct passwords
- `BACKUP_ENCRYPTION_PASSPHRASE`, stored separately from backup files
- non-placeholder `ADMIN_SEED_EMAIL` and production seed password when seeding
- `DEV_AUTO_VERIFY_EMAIL=false`
- `TRUST_PROXY_HEADERS=true` only behind a proxy that strips untrusted forwarded-IP headers

Integration-specific values:

- Google Calendar: client ID, client secret, exact callback URL
- GoPay one-time payments: provider mode, API URL, client credentials, Go ID
- legacy energy: HTTPS API URL, Fernet key, and normally `ALLOW_INSECURE_LEGACY_HTTP=false`
- content/privacy: `PUBLIC_MEDIA_HOSTS` and the approved retention-day values

Production startup validation requires HTTPS `APP_URL`, secrets of the required length, an encryption key that decodes to exactly 32 bytes, a configured email transport, and HTTPS for any configured legacy API unless the explicit override is enabled. Complete GoPay settings are required only when `PAYMENT_PROVIDER=GOPAY`; the current production mode is `FREE`.

When production Compose is used, both database URLs must address service `db:5432`, not host loopback. URL-encode special characters in passwords embedded in these URLs. External energy URLs must be reachable from inside the app container; `127.0.0.1` there means the app container itself.

## Testing expectations

Run checks proportional to the change, and run `npm run preflight` before handoff of a release candidate.

- Unit tests live beside domain modules as `src/**/*.{test,spec}.{ts,tsx}` and run in the Vitest Node environment.
- Playwright end-to-end tests live in `e2e/`, target Chromium, and use port `3004`.
- E2E expects a reachable migrated database.
- Add regression tests for ownership, idempotency, concurrent booking/payment behavior, token expiry, DST boundaries, and external-provider failure fallbacks when those areas change.
- Do not weaken ESLint's zero-warning policy to make a build pass.

## Production Compose

No compose file may join another project's Docker network. Everything outside a stack — the costs catalog, the energy backend, GridLink — is reached over its URL and credentials, so each stack starts on any host. The costs catalog stays on its own machine and is reached through a WireGuard tunnel and VPS with a token; `COSTS_INTERNAL_API_URL` must point inside the tunnel, never at the public internet, and an empty value only disables the catalog rather than breaking the app.

The invoice parser follows the same rule for the same reason: it holds the Codex credential, so it runs only on the host that owns it, behind the `invoice-parser` compose profile, and everywhere else `invoice-coordinator` reaches it over the tunnel with `INVOICE_PARSER_URL` and `INVOICE_PARSER_TOKEN`. The endpoint drives a Codex agent, so both parser and coordinator refuse to start when the URL is not loopback and the token is missing or under 32 characters. Never bundle the Codex credential into a handover for a host that only consumes the parser.

`deploy/compose.prod.yml` uses selective `environment` mappings rather than `env_file`, so secrets are scoped to the services that need them. Compose interpolation does not automatically read `.env.production`; every production command must include `--env-file .env.production`. Start from `deploy/env.production.example` and replace every placeholder.

The production stack provides:

- private PostgreSQL 16 with a healthcheck,
- one-shot owner-privileged migration/role-grant service,
- a limited-role Next.js standalone app bound only to `127.0.0.1:${SPOTTEX_PROD_PORT:-3005}` so the dev build can remain on `3004`,
- 30-second background job runner,
- daily AES-256-CBC/PBKDF2-encrypted custom PostgreSQL backup through a read-only role, with 14-day local retention and a healthcheck failing on a newer dump error or when no successful dump exists within 26 hours.

The app image runs as non-root UID 1001 without the source tree or development toolchain. App, jobs, migration, and backup services drop Linux capabilities and enable `no-new-privileges`; runtime services use read-only root filesystems and bounded tmpfs/resource limits where applicable. The jobs healthcheck requires a completed runner cycle within 45 minutes; backup health requires a successful encrypted dump within 26 hours.

Standard deploy/update:

```bash
cp deploy/env.production.example .env.production
# Replace every placeholder, then validate interpolation before starting:
docker compose --env-file .env.production -f deploy/compose.prod.yml config --quiet
docker compose --env-file .env.production -f deploy/compose.prod.yml up -d --build
docker compose --env-file .env.production -f deploy/compose.prod.yml ps
curl -fsS http://127.0.0.1:3005/api/health
```

A separate reverse proxy owns the public host, TLS, request limits, and proxy headers. Because production forces `TRUST_PROXY_HEADERS=true`, it must discard client-supplied `X-Forwarded-For`/`X-Real-IP` and set authoritative values. Do not expose PostgreSQL or replace the external energy services as part of this stack.

The backup volume is not an off-site backup. Operators must export the already-encrypted `*.dump.enc` files, keep `BACKUP_ENCRYPTION_PASSPHRASE` in a separate secure system, monitor backups, and regularly prove decrypt/restore into a disposable database without writing plaintext to disk. The exact commands are in `README.md`; keep them aligned with `deploy/compose.prod.yml` and always include the production env file.

## Production readiness gates

Before considering a production deployment complete, confirm:

- all development secrets and the seed password were replaced,
- separate owner/app/backup database credentials and the backup-encryption passphrase are provisioned with least privilege,
- seller details, browser-print invoice behavior, absence of a server PDF archive, VAT assumptions, and legal pages were reviewed,
- Google OAuth redirects and Google Meet behavior were tested,
- one-time GoPay environment, callbacks, and reconciliation were tested end-to-end,
- any proposed automatic 20% variable billing has separate merchant `ON_DEMAND` activation and business/legal/accounting approval before implementation,
- the legacy API uses internal TLS and the insecure HTTP override remains disabled,
- reverse proxy, TLS, security headers, request limits, and trusted proxy/IP sanitization are configured,
- `PUBLIC_MEDIA_HOSTS` and retention periods match the approved security/privacy policy,
- Meta Pixel does not load without marketing consent,
- encrypted off-site backups, separate key custody, and job/health monitoring are active,
- a decrypt/restore from the latest real `*.dump.enc` was successfully rehearsed,
- an application image rollback and migration rollback/forward plan exists.

## Repository discipline

- Preserve unrelated working-tree changes; this repository may be edited by multiple agents concurrently.
- Do not edit generated `.next`, `tsconfig.tsbuildinfo`, Prisma client output, the Flutter snapshot, or the `backend-customer-journey/` worktree.
- Use existing APIs and service layers rather than importing Prisma into client components.
- Keep secrets server-only and return stable, non-sensitive API errors.
- Use Zod at API boundaries and database transactions for multi-record invariants.
- Keep `README.md`, `.env.example`, Compose files, scripts, and this guide consistent whenever operational behavior changes.
