# HFG app: Razorpay cart checkout

## Backend provider

Provider ID: `pp_razorpay_razorpay` (distinct from subscriptions and RazorpayX payouts).

Configure `RAZORPAY_CHECKOUT_MODE=live` to use the encrypted, active, verified live Razorpay account saved in Hash Operations. Alternatively, configure server-only `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` without CHECKOUT_MODE. Never ship the secret in the app. Deploy, then in Operations Settings enable this provider for India and remove `pp_system_default` for paid live checkout. An explicit alternative is `npx medusa exec ./src/scripts/hash-enable-razorpay.ts` from the source project. Production must have Redis and `HASH_DEMO_MODE=false`.

Enable automatic capture in the Razorpay account. Checkout completion rejects merely authorized, unpaid, partially paid, mismatched and refunded payments. It reads the Razorpay order and its captured payment directly, verifies INR amount and session identity, and only then reports capture to Medusa. Client success callbacks are not proof of payment. No webhook can independently mark cart orders paid in this implementation.

**Current limit:** automatic cart refunds are disabled and fail explicitly. Refunds require a separately implemented provider-confirmed reconciliation flow before a full production refund rollout. Do not record a successful Medusa refund without a matching real refund. Paid cancellation also fails explicitly instead of implying money was returned. Changing Razorpay account/key requires reconciliation of outstanding payment sessions before rotation.

## App sequence

1. `GET /hash-store/config` to obtain region and publishable key. Network failures mean temporarily unavailable, not an unconfigured store. Offer retry.
2. `POST /auth/customer/hfg` with `{ "token": "HFG_APP_BEARER_TOKEN" }` (the token accepted by HFG `/api/users`, not a Firebase ID token).
3. First login: if the returned JWT has no `actor_id`, create the commerce customer with `POST /store/customers` using that token plus the publishable key, then exchange the HFG token again. Returning customers skip registration. See HFG-STORE-API.md.
4. Create/update the cart, add items, set shipping address. Use the Medusa customer bearer token plus `x-publishable-api-key` on store calls.
5. `GET /store/shipping-options?cart_id=CART_ID`; the cart_id is mandatory. Add the selected shipping method before creating the payment session.
6. Retrieve India payment providers. Create the payment collection and a session using `provider_id: "pp_razorpay_razorpay"`. Do not fall back to `pp_system_default` for real payments.
7. Open Razorpay with `payment_sessions[].data.id` as `order_id`, `data.amount` in **paise**, `data.currency`, and `data.key_id`. Do not multiply `data.amount` by 100 again. The server already converted Medusa rupees to paise. Do not overwrite the returned session data/binding.
8. After Razorpay success, `POST /store/carts/:id/complete`. Only treat `type: "order"` as success. If capture is still pending, keep the same cart/session and retry completion; never charge again just because completion timed out. Recover an already completed cart/order before creating a replacement.
9. If the cart amount changes, create a fresh payment session before paying. Updating a signed session to a different total is rejected.

## Diagnostic results, 25 October 2026

- Health: HTTP 200, 0.89 s; bootstrap config: HTTP 200, 1.10 s.
- HFG exchange with an intentionally invalid diagnostic token: HTTP 401, 0.61 s. This checks route responsiveness, not real customer login.
- Shipping options without cart_id: HTTP 400, 0.89 s, `Invalid request: Field 'cart_id' is required`.
- India providers: HTTP 200, only `pp_system_default` before rollout.
- Render events: startup failures at 08:36 and 08:38 Warsaw time, recovery at 08:41. Logs identify database TCP connection timeouts (`ETIMEDOUT` on 5432; IPv6 `ENETUNREACH`) while loading the Payment module. This is separate from missing Razorpay checkout support.
- Direct API reproduction for Mouse Pad returned HTTP 400: `Direct vendor checkout is not enabled until a payment routing provider is configured`. Its partner, Hash for Gamers Pvt LTD, was configured as vendor direct. With owner approval, the live partner was changed to Hash collects; retrying the same cart successfully added one Mouse Pad.
- TestFlight Add to Cart has not been reproduced here. No app screenshot or real-user error is claimed. Request timestamp, endpoint, HTTP status/body, app version and request ID are needed to correlate an individual failure. Do not share auth tokens.

## Validation

Provider unit tests cover paise conversion, tampered data, cross-session reuse, unpaid orders, mismatched order/payment fields, refunds, outages, changed cart totals and unsigned webhooks. Actual live money has not been charged by these tests.
