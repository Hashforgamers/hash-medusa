# Hash marketplace — frontend and operations handoff

Implemented against Medusa 2.10.1 in this project. The old demo marketplace plugin is disabled: Hash's own ownership checks protect vendor accounts. The HFG frontend repository has not been changed.

## Local setup

Docker Desktop must be running. From this project:

```sh
npm run db:local
npm run hash:setup:local
npm run dev:local
```

The local wrapper always selects PostgreSQL on 127.0.0.1:5433 (or `HASH_LOCAL_DATABASE_URL`) instead of the hosted database in `.env`. It creates a private persistent OTP secret under `.local/`. Database data persists in Docker volume `medusa-local-db-data`.

Portal: `http://localhost:9000/hash-portal`. Hash administrators also have a **Hash Marketplace** page at `/app/hash` and the normal Medusa administration tools. Vendors must use `/hash-portal`; they cannot use the unrestricted native admin endpoints.

The initial local Hash administrator's credentials are in `.local/hash-admin.json` (mode 0600, gitignored). This is a local account, not a production credential. To provision a new deployment, set `HASH_ADMIN_EMAIL` and `HASH_ADMIN_PASSWORD` when running `npm run hash:setup`. Setup does not promote or overwrite an existing account with that email. Run `medusa db:migrate` first on a new Medusa database, then Hash setup. Hash setup is repeatable and prints the frontend's publishable key, region and channel IDs.

Never use the bundled local PostgreSQL password outside local development. For a deployed environment configure `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `HASH_OTP_SECRET`, and the correct `STORE_CORS`, `ADMIN_CORS` and `AUTH_CORS`. Use production-capable Medusa event, workflow and locking providers when running multiple workers; this local instance uses Medusa's in-memory defaults.

## Access and operations

- Hash administrators onboard companies and receive a one-time temporary owner password to share privately. No email is sent automatically.
- Owners and staff must change their temporary password before writing data. Owners can add/remove their own staff. Hash can remove owners and suspend businesses. Every request reloads membership, so removing access applies even to an existing token.
- Vendor users can only see their own listings, orders, stock and settlements. All native admin APIs are denied to vendor accounts except `GET /admin/users/me`.
- Listings support a standard variant, HTTPS image URL, product/service type, INR price, description, and stock/service-slot capacity. Vendors can edit and resubmit them. Edits unpublish the listing for a fresh Hash review. Stock-only updates do not require review.
- Hash can approve/reject listings, edit vendor listings, set commission, configure payment arrangements and review financial activity. Normal Medusa admin handles richer product variants, fulfillment, refunds and operational exceptions.
- A listing is purchasable only when approved, published and its vendor is active. Checkout requires an authenticated Medusa customer, INR, and products from exactly one vendor. The completion workflow checks these rules again.
- `vendor_direct` is stored as a vendor policy but checkout is deliberately unavailable for that mode until direct routing is integrated. It does not silently collect into Hash's account.
- Only one standard variant is managed in this first portal. Service slot capacity is inventory, not a dated booking calendar.

## Financial policy

All ledger amounts ending `_paise` are integer paise. Medusa product and cart amounts are decimal INR (major units), so the boundary conversion is explicit.

The vendor's net entitlement is the order total minus Hash commission. Commission basis points are snapshotted when the order enters the ledger; default 0. The current basis includes the entire order total, including shipping and tax. Tax withholding, provider fees and accounting exports are not inferred. Configure these business rules before introducing charges beyond the agreed commission.

1. Full successful **capture**, not authorization, schedules the first half.
2. Customer OTP verification marks delivery/service completion and schedules the remainder.
3. Odd paise go to the completion portion so the two portions exactly equal the net entitlement.
4. Each portion is due at 00:00 Asia/Kolkata on the next business day. Saturdays/Sundays are skipped. Set `HASH_SETTLEMENT_HOLIDAYS=2026-10-19,2026-12-25,...` to add applicable bank holidays. This is a configurable calendar, not an automatically maintained India banking calendar.
5. Reconciliation runs each minute, on order placement/cancellation, before OTP operations and before recording payouts. Hash can also run it manually.
6. Hash transfers money outside this app, then records a unique bank/UTR reference. Only due, unheld, positive settlements are payable. Retrying the same reference is idempotent. Paid records are not overwritten. Failure records can be retried.
7. Refunds/cancellations hold unpaid transfers. Hash's **Review adjustment** recalculates unpaid entitlement, preserves already-paid records and reports any overpayment as `recovery_paise`. A subsequent refund reopens the hold. Recoveries are visible for manual follow-up; the app does not debit a vendor's bank account.

This local setup uses Medusa's manual payment provider for testing. A successful manual capture in Medusa is not proof that real money arrived. Live customer payments require your payment provider's verified capture/webhook integration. The payout side remains manual until a provider is added.

## HFG API integration

Use HTTPS in deployment. Store requests require `x-publishable-api-key`. Never embed Hash administrator or vendor tokens in HFG's customer-facing bundle.

### Customer identity

Use Medusa customer auth (`/auth/customer/emailpass` plus `/store/customers` account creation) or a separately implemented trusted identity bridge to the existing HFG identity system. An existing HFG JWT is not automatically a Medusa customer token. The customer must own the Medusa order to request its completion OTP.

### Browse products

`GET /store/hash/products?vendor_id=hv_...&limit=20&offset=0`

```json
{
  "products": [{
    "product_id": "prod_...",
    "vendor_id": "hv_...",
    "vendor_name": "Partner company",
    "title": "Service name",
    "kind": "service",
    "variant_id": "variant_...",
    "price_inr": 1001.01,
    "available": 10,
    "thumbnail": "https://..."
  }],
  "count": 1,
  "limit": 20,
  "offset": 0,
  "currency_code": "inr"
}
```

Only approved, published listings from active vendors are returned. Use the returned `variant_id` in Medusa's normal cart APIs. The server owns pricing; do not send a customer-controlled price.

### Checkout

1. Create `/store/carts` with the India `region_id`, authenticated customer, email, shipping address and `{variant_id, quantity}` items.
2. Add/remove line items with Medusa's standard cart APIs. Show a separate-cart message if another vendor is selected.
3. Fetch `/store/shipping-options?cart_id=...`, choose a method, and POST `/store/carts/:id/shipping-methods`.
4. POST `/store/payment-collections` with `{cart_id}` and `/store/payment-collections/:id/payment-sessions` with the configured provider.
5. Complete `/store/carts/:id/complete` after the provider's payment flow. Follow Medusa's returned payment-required/error state instead of assuming success.

Hash setup creates a zero-priced standard delivery option for local end-to-end testing. Configure actual delivery rules before going live.

### Completion OTP

`GET /store/hash/orders/:id` with the customer's bearer token returns:

```json
{"order":{"id":"order_...","paid":true,"completed_at":null,"completion_eligible":true}}
```

`POST /store/hash/orders/:id/otp` with the same token and `{}` issues:

```json
{"code":"123456","expires_at":"...","instruction":"Share this code with the vendor only after successful delivery or service completion."}
```

This is an **in-app customer OTP**, not an SMS message. Display it only to the authenticated customer after explaining its consequence. Do not log it, put it in a URL, or automatically forward it to the vendor. A future notification adapter can send it via SMS instead; no SMS provider has been assumed.

The vendor enters the code in the portal. The backend stores an HMAC digest, expires codes after 10 minutes, enforces a 60-second resend cooldown, permits five failed attempts, and locks issuance for 15 minutes after exhaustion. Reissue invalidates the previous code. Repeated successful verification never creates a duplicate settlement.

The customer status endpoint is the completion source for HFG. This service-completion state is separate from Medusa's physical-shipping fulfillment lifecycle.

### Vendor / Hash API

Authenticate at `POST /auth/user/emailpass` with `{email,password}`. The portal uses the returned bearer token in tab-scoped storage. `GET /admin/hash` returns role-filtered dashboard data. `GET /admin/hash?order_id=...` returns scoped order items and delivery details.

Commands are `POST /admin/hash` with an `action` field. Strict field validation and ownership checks are implemented in `src/api/admin/hash/route.ts`:

| Action | Who | Purpose |
|---|---|---|
| `onboard` | Hash | Company + owner login |
| `add_member`, `remove_member` | Owner / Hash | Team access |
| `change_password` | Signed-in user | Verify old password and set a new one |
| `save_product`, `stock` | Owning vendor / Hash | Listing and inventory management |
| `review_product`, `vendor_settings` | Hash | Approval, status and policy |
| `verify_otp` | Owning vendor / Hash | Confirm customer-approved completion |
| `reconcile` | Hash | Refresh ledger from Medusa payment records |
| `record_payout`, `payout_failed` | Hash | Manual transfer records |
| `review_adjustment` | Hash | Review refunded/canceled order entitlement |

The dashboard currently returns up to 500 recent orders and 1,000 settlements; reconciliation processes all orders in batches of 100. A larger deployment should add filtered pagination and an incremental reconciliation cursor.

## Adding a payout provider later

`src/lib/hash/payouts.ts` defines `PayoutAdapter`, a registry, and the manual adapter. Settlement policy, OTP confirmation and the persistent ledger do not depend on a provider SDK. To connect a provider:

- Implement/register its adapter, use `settlementId` as the provider idempotency key, and add beneficiary onboarding.
- Add a durable dispatch workflow that reserves the due settlement as `processing` before calling the provider. Use verified callbacks/polling to mark it paid or failed. Never retry an ambiguous bank transfer as a new request.
- Verify webhook signatures and unique provider event IDs, and match vendor, currency and amount before updating the ledger.
- Keep `record_payout` explicitly manual; a UI button that records a completed bank transfer should not unexpectedly start a provider transfer.

No external payment credentials or provider endpoints are configured by this implementation.

## Verification

```sh
npm run test:hash:policy
npx tsc --noEmit
npm run build
# On the disposable local database only; creates clearly labelled QA fixtures:
npm run test:hash:api
npm run test:hash:refund
```

API tests use `.local/hash-admin.json`. Checkout tests simulate Medusa manual captures and deliberately advance fixture settlement due dates / OTP cooldown timestamps to exercise the policies without waiting. They must never run against live customer data. The tests cover vendor isolation, owner/admin permissions, listing approval, inventory, mixed-vendor rejection, payment reconciliation, OTP attempt limits and replay safety, odd-paise arithmetic, premature payout denial, duplicate/concurrent payout recording, refund holds and overpayment recovery.

Edit the readable portal in `src/lib/hash/portal.html`; run `node scripts/hash-build-portal.cjs` after editing it. The build regenerates the route automatically.
