# Render and Vercel deployment

## Render backend

Create a separate Docker web service from `Hashforgamers/hash-medusa`, branch `main`. Set the root directory to `medusa-marketplace-demo`, Dockerfile to `./Dockerfile`, and health check path to `/health`. The Docker command runs migrations, idempotent Hash setup, then Medusa. Use a single instance during initial setup.

Use dedicated persistent PostgreSQL and Redis resources in the same Render region. Set `DATABASE_URL` and `REDIS_URL` to their internal connection URLs. Set `NODE_ENV=production`, `PORT=9000`, and independent cryptographically random values of at least 32 characters for `JWT_SECRET`, `COOKIE_SECRET`, and `HASH_OTP_SECRET`.

Set `ADMIN_CORS=https://partners.hashforgamers.com`. Set `STORE_CORS` to the actual HFG frontend origin. Set `AUTH_CORS` to both origins, comma separated. Add the actual Vercel production origin if needed for pre-DNS testing. No wildcard origins.

For first deployment only, set `HASH_ADMIN_EMAIL` and a strong `HASH_ADMIN_PASSWORD`. Remove both after successful setup. Setup never resets an existing account's password or privileges. Do not upload local credentials, `.env`, or the local database.

Keep PostgreSQL backups enabled and retain the OTP secret across deploys. Run migrations before additional instances if scaling later. Confirm resource pricing before provisioning new paid resources.

## Vercel portal

Import the same repository at its root. `vercel.json` builds a static portal without installing backend dependencies. Set the production environment variable `HASH_BACKEND_URL` to the Render service's HTTPS origin, then deploy `main`.

Add `partners.hashforgamers.com` to the project. Apply the exact DNS record Vercel supplies at the authoritative DNS provider; do not change unrelated records. Verify domain ownership and HTTPS provisioning in Vercel.

## Verification

Check backend `/health`, portal sign-in, vendor isolation, and a listing approval. Share the HFG publishable API key and region/channel IDs with the frontend team via an appropriate channel. Publishable keys are public identifiers; admin passwords and JWT/OTP secrets are not.

Live payment collection is not configured: the manual payment provider is for controlled testing. The ledger records eligibility and external payouts, not bank transfers. Configure and verify the payment provider before live customer checkout.

## Free demo deployment

Set `HASH_DEMO_MODE=true` to explicitly allow in-memory processing without Redis. This runs one instance for demonstration only; background state does not survive restarts. Do not use for live transactions. The Render free database created for this demo expires November 18, 2026. Export or upgrade before expiry. Free web instances sleep when idle.
