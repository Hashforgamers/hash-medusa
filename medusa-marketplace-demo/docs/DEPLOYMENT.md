# Render and Vercel deployment

## Render backend

Create a separate Docker web service from `Hashforgamers/hash-medusa`, branch `main`. Leave Root Directory empty, set Dockerfile to `./medusa-marketplace-demo/Dockerfile`, Docker Build Context Directory to `./medusa-marketplace-demo`, and health check path to `/health`. This lets changes anywhere in the repository trigger deployment. The Docker command runs migrations, idempotent Hash setup, then Medusa. Use a single instance during initial setup.

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

Set `HASH_DEMO_MODE=true` to explicitly allow in-memory processing without Redis. This runs one instance for demonstration only; background state does not survive restarts. Do not use for live transactions. Free web instances sleep when idle, so the first sign-in can take longer while the backend wakes. The active database is Neon, not the temporary Render PostgreSQL database.


## Hosted configuration (October 20, 2026)

- Portal: https://partners.hashforgamers.com (Vercel project `hash-partners`).
- Fallback portal: https://hash-partners.vercel.app.
- Medusa: https://hash-medusa.onrender.com (Render free service `hash-medusa`).
- Database: Neon project `hfg-backend-aws`, branch `main`, separate database `hash_marketplace`. Use its direct TLS connection URL in Render `DATABASE_URL`; the existing HFG database is unchanged. Neon usage follows the existing account plan.
- DNS: Squarespace CNAME `partners` → `1789c8e867ed4702.vercel-dns-017.com`.
- Redis: none in demo mode; no new paid Render resources.

Hosted data starts fresh; local demo vendors and products were not copied. Credentials remain in private, gitignored local handoff files and deployment environment settings.

## Automatic main-branch releases

Every merge or direct push to `main` runs `.github/workflows/main-deploy.yml`, without path filters. Pull requests run the same validation; manual runs are also available. Checks include TypeScript, unit and settlement-policy tests, the Medusa build, generated-portal consistency, and the Vercel portal build.

Hosting uses the existing GitHub integrations, not deploy hooks:

- **Render / hash-medusa:** linked to `main`, Auto-Deploy **After CI Checks Pass**. Render starts its backend deployment after the commit checks succeed, including the Vercel check. Its Docker startup runs database migrations and idempotent Hash setup.
- **Vercel / hash-partners:** production branch `main`; automatically builds and deploys pushes through its GitHub integration. This runs independently of Actions; it does not wait for the backend checks.
- No `RENDER_DEPLOY_HOOK`, `VERCEL_DEPLOY_HOOK`, hosting API token, or production database secret is required in GitHub Actions.

Check GitHub Actions for validation and each hosting dashboard for rollout status. A green Actions run is not confirmation that the backend rollout has finished. Releases across the two providers are not atomic, so keep portal/backend changes backward-compatible. The free Render instance can take time to wake up. Existing provider account/billing restrictions still apply.

The old hook-based deploy job was removed because it duplicated the connected hosting integrations and failed without optional secrets. Its historical failed run remains in GitHub; use the newest main-branch run for current status.

References: [Render automatic deploys](https://render.com/docs/deploys#automatic-deploys), [Vercel Git deployments](https://vercel.com/docs/git).
