# GODIA PRIME CONNECT SOLUTIONS
## Cloudflare D1 and Deployment Instructions

### 1. Project status

This project contains the GODIA PRIME CONNECT frontend,
Cloudflare Worker starter, and database migration files.

Deployment and database functionality must be tested before
the application is considered production-ready.

### 2. Required repository files

- public/index.html
- public/godia-prime-icon.svg
- public/manifest.webmanifest
- public/godia-welcome-instrumental.wav
- src/index.js
- migrations/0001_gpc_core.sql
- migrations/0002_customer_plan_access.sql
- package.json
- wrangler.toml

### 3. Confirm the correct Cloudflare account

Before making changes, sign in to the intended Cloudflare account.

Inspect the existing D1 databases and Workers.

Do not delete, reset, or replace an existing database just to
make deployment easier.

Record the exact database name and ID of the database intended
for this project.

### 4. Configure the D1 binding

The Worker must use the D1 binding name:

DB

The database name and database ID must match the confirmed
database in Cloudflare.

Do not guess or invent a database ID.

### 5. Apply database migrations

After confirming the correct database, apply these files in order:

1. migrations/0001_gpc_core.sql
2. migrations/0002_customer_plan_access.sql

Use the Cloudflare D1 console or another supported migration
method.

Verify that the expected tables and indexes exist afterward.

Do not assume that uploading SQL files to GitHub creates
database tables.

### 6. Deployment

Review wrangler.toml and confirm that:

- The Worker name is correct.
- The entry point is src/index.js.
- The compatibility date is valid.
- Static assets point to the public directory.
- The D1 binding uses the correct database.

Only deploy after verifying the configuration.

### 7. Initial testing

Test the following after deployment:

- GET /api/health
- Static homepage loading
- Customer registration
- Customer login
- Session validation
- Logout
- Database reads and writes
- Owner permission restrictions
- Customer access controls

A successful deployment alone does not prove that every
application feature works.

### 8. Security requirements

- Never put passwords, PINs, API secrets, or access tokens in
  GitHub source files.
- Do not assign owner privileges through public registration.
- Verify owner identity before provisioning an owner account.
- Configure appropriate production CORS origins.
- Use secure session handling and server-side permissions.

### 9. Payment status

M-Pesa Daraja integration, payment callback verification,
supplier payment routing, and subscription payment enforcement
must be implemented and tested separately.

Do not claim that a payment succeeded until the server has
verified the transaction.

### 10. Production readiness

The project must pass functional, security, database, and
payment tests before it is used for live business transactions.
