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

Set `HASH_DEMO_MODE=true` to explicitly allow in-memory processing without Redis. This runs one instance for demonstration only; background state does not survive restarts. Do not use for live transactions. Free web instances sleep when idle, so the first sign-in can take longer while the backend wakes. The active database is Neon, not the temporary Render PostgreSQL database.


## Hosted configuration (October 20, 2026)

- Portal: https://partners.hashforgamers.com (Vercel project `hash-partners`).
- Fallback portal: https://hash-partners.vercel.app.
- Medusa: https://hash-medusa.onrender.com (Render free service `hash-medusa`).
- Database: Neon project `hfg-backend-aws`, branch `main`, separate database `hash_marketplace`. Use its direct TLS connection URL in Render `DATABASE_URL`; the existing HFG database is unchanged. Neon usage follows the existing account plan.
- DNS: Squarespace CNAME `partners` → `1789c8e867ed4702.vercel-dns-017.com`.
- Redis: none in demo mode; no new paid Render resources.

Hosted data starts fresh; local demo vendors and products were not copied. Credentials remain in private, gitignored local handoff files and deployment environment settings.

## Automatic main-branch release workflow

`.github/workflows/main-deploy.yml` runs on **every push to main**, including merges and direct pushes, with no path filters. Pull requests run validation only. Manual reruns are available in GitHub Actions. Validation runs TypeScript, unit and settlement-policy tests, the Medusa build, generated-portal consistency, and the static Vercel portal build. No production database credentials are needed by CI.

One-time activation (not configured by adding these files alone):

1. Render `hash-medusa` → Settings → Deploy Hook: save its URL as repository Actions secret `RENDER_DEPLOY_HOOK`.
2. Vercel `hash-partners` → Settings → Git → Deploy Hooks: create a hook targeting **main** and save its URL as `VERCEL_DEPLOY_HOOK`.
3. Disable Render's automatic Git deploys so the workflow is the single deployment trigger. For Vercel, use an Ignored Build Step to skip automatic Git builds as described in Vercel's current deploy-hook documentation; verify hook-triggered builds still run. Do not set `github.enabled=false`, which also disables deploy hooks.
4. Push this workflow to GitHub main. Verify the first Actions run and both provider deployments. Missing secrets deliberately fail the deployment job; they do not silently skip deployment.

The deploy job sends Render the validated commit SHA. Vercel's hook deploys the latest commit on its configured main branch; a push during execution may advance that ref. Releases are serialized and obsolete queued commits are skipped, but the two providers are not an atomic release. Keep backend and portal changes backward-compatible. A successful trigger means the hosting service accepted the request; provider builds, migrations and health checks can still fail. Use Render/Vercel deployment notifications for those failures and GitHub Actions notifications for failed checks/triggers. No paid services or new databases are provisioned by this workflow.

References: [Render deploy hooks](https://render.com/docs/deploy-hooks), [Vercel deploy hooks](https://vercel.com/docs/deploy-hooks).
