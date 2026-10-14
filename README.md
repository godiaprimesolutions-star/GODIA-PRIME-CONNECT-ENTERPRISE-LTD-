# GODIA PRIME CONNECT SOLUTIONS — GitHub + Cloudflare project

**Tagline:** BIASHARA ZINAUNGANISHWA. FURSA ZINAONGEZWA.

This repository packages the cleaned existing frontend with its current Cloudflare Worker starter, static assets, and additive D1 SQL migrations. It is intended to be uploaded to the existing GitHub repository and then connected to the correct Cloudflare account. It is **not a declaration that the production application is complete or live**.

## Project files

- `public/index.html` — the cleaned GODIA PRIME CONNECT app HTML served by Cloudflare Static Assets.
- `public/godia-welcome-instrumental.wav` — welcome instrumental, played only after the visitor taps the relevant control because browsers restrict autoplay.
- `public/godia-prime-icon.svg`, `public/manifest.webmanifest` — app icon and PWA metadata.
- `src/index.js` — Cloudflare Worker API starter, health route, customer registration/login/session routes, and owner temporary customer-access routes.
- `migrations/0001_gpc_core.sql` — additive GODIA tables for accounts, sessions, login attempts, and audit logs.
- `migrations/0002_customer_plan_access.sql` — additive table for temporary free-plan grants/locks.
- `wrangler.toml` — Worker name, entry point, compatibility date, and static assets configuration. No guessed D1 ID is included.
- `package.json` — Wrangler development/deploy/check commands.
- `docs/` — mobile upload, database, and status instructions.

## Important: this is not yet production-ready

The frontend, Worker, and migrations are packaged together, but live Cloudflare and D1 deployment have not been verified from this bundle. The frontend's basket/orders and some pricing/settings are still browser-local and are not shared/synced with D1. Full POS operations and subscription enforcement, M-Pesa Daraja STK Push/callback verification, supplier payment routing, automatic SMS/WhatsApp, live AI, full product/order CRUD, and account recovery are not complete. Do not accept live payments or promise those features as live until implemented and tested.

## Safe setup sequence

1. Extract this ZIP on your phone. Upload the **contents inside this folder**, not the ZIP file itself, into the intended GitHub repository. Keep `public/`, `src/`, `migrations/`, and `docs/` as folders at the repository root.
2. In Cloudflare, choose the correct account and connect that exact GitHub repository to a Worker. Use `wrangler.toml` and `src/index.js`; the deployment command is `npx wrangler deploy`.
3. Before binding a D1 database, inspect existing Cloudflare databases and confirm the exact intended database. Do not create a replacement, delete a database, or reset data just to make deployment pass.
4. Add the confirmed D1 database to the Worker with binding name `DB`. The configuration intentionally has no database ID because it must not be guessed.
5. Apply `migrations/0001_gpc_core.sql` and then `migrations/0002_customer_plan_access.sql` to the confirmed database, only after confirming the database identity. See `docs/D1_AND_DEPLOYMENT_STEPS.md`.
6. Deploy and test `/api/health`, registration/login, owner permissions, customer access, static assets, and database writes. Do not share secrets in GitHub, HTML, or ChatGPT.

## Important owner-account note

New public registrations receive the `customer` role. Do not promote an account to `owner` until its identity is confirmed and you have followed a secure, audited owner-provisioning procedure. Never hard-code an owner password or PIN into source code.
