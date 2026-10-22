# Hash Operations: plans, payout providers and Razorpay

## Dashboard workflow

Open **Plans & Payouts** as a Hash super admin. Vendors and staff cannot change finance configuration.

### Vendor settlement plans

Create a named plan with a capture percentage (0–100%), capture/completion delays (0–365 days), business or calendar days, IANA timezone, weekend days and holidays. The remainder is due after customer OTP completion. A zero delay means immediately eligible at the event timestamp; positive delays mean local midnight on the calculated date. Commission remains partner-specific. No transfer is sent merely because a settlement becomes due.

Set a store default or assign a plan to each partner, including during onboarding. Plans can be edited, archived and reassigned. An assigned/default plan cannot be archived until replaced. Each order snapshots its plan when first reconciled at order placement. Edits apply to new orders, not existing obligations. Existing ledger rows retain their original due dates and amounts. Historical orders preserve the old 50/50 rules. The initial 50/50, T+1, India calendar is a seeded editable default, not a mandatory rule. Rounding allocates the final minor unit to completion.

### Payout partners

For **RazorpayX**, choose **Connect RazorpayX** and enter the key ID, key secret, your funding-account number and bank transfer mode. Hash supplies the endpoint, authentication, bank-field mapping and idempotency header. Your account must be approved for RazorpayX composite payouts. Razorpay customer payment keys and RazorpayX capabilities are separate.

For another compatible provider, **Other provider (advanced)** offers form-based request-field mappings, HTTPS endpoint, authentication, supported currencies, reference/status response fields and idempotency header. Supports bearer tokens, API-key headers and Basic authentication (`key ID:secret` in the credential field). Nested request/response fields use dot notation. Credentials belong in the credential field, not fixed-text request mappings.

This is not universal support for every API. OAuth refresh, signed requests, prior beneficiary registration, provider-specific approval workflows and non-JSON protocols still require an adapter. Unknown/reversed/failed responses are held for review rather than assumed safe to retry. Fixed text mapping values are strings; use the built-in RazorpayX preset for its typed fields.

Saving or changing a connection disables it until reviewed. Assign it to a partner, verify the partner bank account, and use **Review transfer** on a due settlement. A persisted attempt and UUID idempotency key are created before the network request. Concurrent clicks cannot send the same settlement twice. A timeout or process crash stays `processing`; inspect the provider before **Resolve with evidence**. Only a confirmed `not_sent` outcome permits retry. A successful transfer reference is unique per provider. Automatic provider webhook/polling reconciliation is not implemented for generic payouts; pending transfers need operator review.

`HASH_DEMO_MODE=true` blocks all outbound payout transfers and live customer subscription enrollment. Manual bank recording remains available. Do not disable this just to bypass the restriction without making the hosting/payment setup suitable for real transactions.

Provider secrets are AES-256-GCM encrypted. Prefer a stable `HASH_PAYOUT_ENCRYPTION_KEY` of at least 32 characters; otherwise the application derives a purpose-specific key from a sufficiently long JWT secret, or its OTP secret for local development. Back up the encryption key: changing the selected key requires re-entering provider credentials. GET responses and audit events never contain the decrypted credentials. Requests reject private/reserved network destinations and redirects.

## Customer plans and Razorpay

Customer plans are **fixed-price standalone billing agreements** (for example a Hash membership). They do not pay for or fulfill a Medusa cart, reserve inventory, grant app entitlements, or enter the vendor settlement ledger. Ordinary store purchases continue through the existing full-payment cart checkout. Applying instalments to arbitrary store carts or distributing subscription revenue to vendors requires a separate order/fulfillment integration; do not treat a subscription redirect as a paid store order.

1. **Configure test account**: enter Razorpay key ID, API secret and a webhook secret. These are stored encrypted. **Verify connection** performs a read-only plans request.
2. In Razorpay, configure `https://YOUR_BACKEND/hash-webhooks/razorpay/test` with the same webhook secret. Subscribe to subscription events (including `subscription.charged`) and `refund.processed`. Use `/live` for the live account. Hash shows the last valid signed delivery time.
3. Create a customer plan. Subscription amounts are per cycle, with interval, trial period and a finite billing-cycle count. Instalment amounts are the entire agreed total, with an upfront percentage, remaining instalment count and interval. Rounding remainder is included in the initial charge; the public schedule shows exact minor-unit amounts.
4. **Sync to Razorpay**, choose test mode, then **Publish**. Editing unpublishes the plan and requires resync. Existing subscriptions keep their original terms. The current adapter supports INR; Razorpay daily intervals must be at least 7 days and each regular charge at least INR 1. Recurring charges are bounded, not unlimited.
5. The app displays the exact terms/mode and obtains explicit consent, then opens the returned hosted Razorpay checkout. Razorpay collects the customer's payment mandate. Hash never stores card details.
6. Production activation requires live credentials, a verified connection, a successfully delivered signed live webhook, provider account approval and non-demo hosting. Test mode never becomes live merely by publishing a plan.

The dashboard shows enrollments, provider status and paid-cycle count. Operators can refresh status, cancel future renewal at cycle end, and recover uncertain creation by linking a provider subscription whose notes match the Hash enrollment ID. Changing to a different Razorpay key ID is blocked while nonterminal subscriptions use the existing account. Credential updates disable new enrollment until verified. Retain the existing webhook secret during retries; automatic old-secret rotation is not implemented.

## App API handoff

Use the existing HFG-to-Medusa customer session/token. No `hfg-user-onboard` database changes are required. All `/store` calls require the bootstrap publishable key. Subscription calls additionally require the authenticated Medusa customer token.

- `GET /store/hash/payment-plans?currency_code=inr`: published, currently available plans; draft plans and provider credentials are excluded. Recurring plans include `mode` and `schedule` (`cycle`, `upfront`, `count`, `period`, `interval`) in minor units. One-time entries describe the ordinary full-payment checkout; they do not override catalog prices.
- `POST /store/hash/subscriptions`: `{ "plan_id":"…", "revision":1, "request_key":"UUID", "accept_terms":true }`. Display terms before accepting. The server uses the stored price/revision, never a client-supplied amount. Reuse the same request key for retries. Response `subscription.checkout_url` opens Razorpay; `needs_review` means do not create another request with a new key.
- `GET /store/hash/subscriptions`: current customer's enrollments.
- `GET /store/hash/subscriptions/:id`: owned subscription and verified captured-payment/refund ledger. Never infer payment from checkout success alone.
- `POST /store/hash/subscriptions/:id`: `{ "action":"refresh" }` or `{ "action":"cancel" }` (cancel at cycle end).

Webhook signatures use the raw request bytes and HMAC-SHA256. Duplicate subscription event IDs are ignored. Canonical provider subscription/payment reads prevent stale webhook events from regressing subscription state. Signed refund events refresh the stored refund amount. Refunds are initiated in Razorpay, not from this UI.

Super-admin management uses `GET/POST /admin/hash/finance`. Actions: `save_plan`, `default_plan`, `plan_state`, `assign`, `save_connector`, `save_razorpay_payout`, `connector_state`, `execute`, `resolve`, `save_customer_plan`, `customer_plan_state`, `razorpay_settings`, `razorpay_verify`, `sync_customer_plan`, `manage_subscription`, `link_subscription`. Schemas are in the route and finance modules. Stale edit revisions are rejected. Temporary-password accounts cannot make changes.

## Validation and activation status

Local tests use mocked Razorpay responses; no real provider charges or payouts are made. Provider-account end-to-end testing requires your test credentials, public webhook delivery and mandate authorization. These are not supplied by the source code. Run normal Hash setup to apply additive migrations before serving these routes. Keep finance configuration in the database, secrets in encrypted columns and encryption keys in hosting environment settings.

References: [Razorpay Plans](https://razorpay.com/docs/api/payments/subscriptions/create-plan/), [Subscriptions](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/), [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/), [RazorpayX composite payouts](https://razorpay.com/docs/api/x/payout-wallet/create/payout-composite/).
