# HFG Store integration contract

Local implementation for Medusa 2.10.1. These changes have NOT been pushed or deployed.
The existing `hfg-user-onboard` service and its database require no changes. Medusa requires the local HFG auth provider and Cloudinary upload endpoint in this change, followed by configuration/deployment when approved.

Import [the Postman collection](HFG-STORE.postman_collection.json) for the main customer flow. Fill its local environment variables; it contains no credentials.

## Configuration and identity

Frontend config:

```text
MEDUSA_BASE_URL=http://localhost:9000
MEDUSA_PUBLISHABLE_KEY=<HFG Frontend key from hash:setup:local>
INDIA_REGION_ID=<India region from hash:setup:local>
```

Future deployed origin: `https://hash-medusa.onrender.com`. Do not point a frontend at the new auth API there until this change is deployed. IDs and keys differ between local and hosted databases. Find the publishable key in Medusa Admin or setup output; select the INR India region from `GET /store/regions`. Never put admin tokens, Cloudinary secrets or the Medusa JWT signing secret in the frontend.

Every `/store/*` request needs `x-publishable-api-key`. Customer-specific requests also need `Authorization: Bearer <MEDUSA_CUSTOMER_TOKEN>`. JSON requests need `Content-Type: application/json`.

### Existing HFG users: no second password

1. Obtain the user's current **HFG app bearer token** through the existing login flow. This is the token accepted by authenticated `GET /api/users` in hfg-user-onboard, not a Firebase ID token, FID, email, or user ID.
2. Call `POST /auth/customer/hfg` on Medusa with `{"token":"<HFG_APP_TOKEN>"}`. Response: `{"token":"<MEDUSA_TOKEN>"}`. The provider validates the HFG token server-to-server against the configured `HFG_USER_ONBOARD_URL/api/users`. Invalid/expired/deleted accounts and upstream failures fail closed with 401.
3. On first use only, the returned Medusa JWT has an empty `actor_id`. Decode its payload solely to choose the registration UI path (never as proof of authentication). Call `POST /store/customers` with that bearer token and the publishable key. Body can be `{}` for phone-only accounts, or `{"first_name":"Player","email":"player@example.com","phone":"+919876543210"}`. Response: `{"customer":{...}}` (200). Supply real profile/contact information; do not fabricate emails. Identity ownership is determined by the validated HFG ID, not the submitted contact fields.
4. Exchange the HFG token again via step 2 after customer creation. The new JWT has the linked Medusa `customer_id` as its `actor_id`.
5. Returning users skip step 3. `GET /store/customers/me` returns `{"customer":{...}}`.

If simultaneous first-use requests race, re-exchange the HFG token and check `/store/customers/me` before retrying creation. Do not repeatedly register on every login or link accounts by matching email. An existing Medusa email/password customer is not automatically merged into an HFG identity.

The provider maps the stable authenticated numeric HFG user ID to a Medusa auth identity (`hfg:<id>`). Medusa keeps commerce-specific customer, address, cart and order records in its own database. HFG remains the user identity source. No HFG password or token is stored by this provider. Tokens from HFG and Medusa are not interchangeable.

Keep the Medusa token in secure app storage (or tab memory on web); never log it. On HFG logout clear the Medusa token/cart UI and, if using cookies, call `DELETE /auth/session`. Refresh store access by exchanging a valid HFG token again rather than storing a second password. The bridge validates HFG account status at exchange time; an already issued Medusa token remains valid until its Medusa expiry. Immediate cross-service revocation is not implemented. Configure an appropriate Medusa JWT lifetime for production.

## Customer API inventory

All paths below are relative to `MEDUSA_BASE_URL`. “Customer” means the linked Medusa bearer token plus publishable key; “Public” still requires the publishable key.

| Method | Path | Auth | Request / result |
|---|---|---|---|
| POST | `/auth/customer/hfg` | HFG token in JSON | `{token}` → `{token: MEDUSA_TOKEN}` |
| POST | `/store/customers` | Registration token | Optional contact fields → `{customer}`; first use only |
| GET | `/store/customers/me` | Customer | `{customer}` |
| POST | `/store/customers/me` | Customer | `{first_name,last_name,phone}` → `{customer}` |
| GET | `/store/regions` | Public | `{regions,count,offset,limit}`; select INR + India |
| GET | `/store/hash/products` | Public | `vendor_id`, `limit` (1–100), `offset`; approved catalog |
| GET | `/store/products/:id` | Public | Medusa product details; optional `region_id` for pricing |
| GET | `/store/products` | Public | Medusa filters/pagination/pricing; Hash approval filtering applies |
| POST | `/store/carts` | Customer | `{region_id,email,items:[{variant_id,quantity}],shipping_address}` → `{cart}` |
| GET | `/store/carts/:id` | Customer | `{cart}`; use server totals |
| POST | `/store/carts/:id` | Customer | `{email,shipping_address,billing_address}` → `{cart}` |
| POST | `/store/carts/:id/customer` | Customer | `{}` → `{cart}`; attach a guest cart to signed-in customer |
| POST | `/store/carts/:id/line-items` | Customer | `{variant_id,quantity}` → `{cart}` |
| POST | `/store/carts/:id/line-items/:item_id` | Customer | `{quantity}` → `{cart}` |
| DELETE | `/store/carts/:id/line-items/:item_id` | Customer | Deletion result including parent cart |
| GET | `/store/shipping-options?cart_id=:id` | Customer | `{shipping_options}` |
| POST | `/store/carts/:id/shipping-methods` | Customer | `{option_id}` → `{cart}` |
| GET | `/store/payment-providers?region_id=:id` | Customer | `{payment_providers}` |
| POST | `/store/payment-collections` | Customer | `{cart_id}` → `{payment_collection}` |
| POST | `/store/payment-collections/:id/payment-sessions` | Customer | `{provider_id,data:{}}` → `{payment_collection}` |
| POST | `/store/carts/:id/complete` | Customer | `{}` → `{type:"order",order}` OR `{type:"cart",cart,error}` |
| GET | `/store/orders?limit=20&offset=0` | Customer | Customer order history: `{orders,count,offset,limit}` |
| GET | `/store/orders/:id` | Customer | `{order}` with line items, shipping, payment and fulfillment details |
| GET | `/store/hash/orders/:id` | Customer | Hash payment/completion eligibility (below) |
| POST | `/store/hash/orders/:id/otp` | Customer | `{}` → `{code,expires_at,instruction}` |
| GET | `/store/customers/me/addresses` | Customer | `{addresses,count,offset,limit}` |
| POST | `/store/customers/me/addresses` | Customer | Address fields → `{customer}` |
| POST | `/store/customers/me/addresses/:id` | Customer | Updated address fields → `{customer}` |
| DELETE | `/store/customers/me/addresses/:id` | Customer | Deletion result |

Cart identifiers must stay scoped to the current account in the frontend. Standard Medusa guest-cart APIs are capability-based, not a private account-data vault: do not leak cart IDs. Do not expose admin order, payout or partner APIs to shoppers.

## Catalog and image contract

```http
GET /store/hash/products?limit=20&offset=0&vendor_id=hv_...
x-publishable-api-key: pk_...
```

```json
{"products":[{"product_id":"prod_...","vendor_id":"hv_...","vendor_name":"Partner","title":"Gaming session","description":"One hour","kind":"service","variant_id":"variant_...","price_inr":400,"available":5,"thumbnail":"https://res.cloudinary.com/<cloud>/image/upload/..."}],"count":1,"offset":0,"limit":20,"currency_code":"inr"}
```

Render `thumbnail` directly as the image URL; do not upload the image again from HFG. Handle empty thumbnails. New partner uploads use Cloudinary URLs; legacy HTTPS images remain readable. Only active vendors' approved/published listings are returned. Use `variant_id`, not `product_id`, to add an item to the cart. `price_inr` is INR major units; settlement ledger fields ending `_paise` are integer paise. Backend prices and inventory are authoritative.

## Checkout sequence

1. Browse publicly; sign into HFG and establish the Medusa customer session before checkout.
2. Create a cart using the India region and one vendor's variants. Add a real checkout email and shipping address before completing. Address example:

```json
{"first_name":"Player","last_name":"Name","address_1":"Street address","city":"Mumbai","province":"Maharashtra","postal_code":"400001","country_code":"in","phone":"+919876543210"}
```

3. Keep one vendor per cart. If a shopper selects another vendor, offer to start a separate cart. The backend rejects mixed-vendor and non-INR checkout, unavailable listings, and unsupported vendor-direct payment.
4. Fetch shipping options and add the chosen `option_id`. Local setup has a zero-priced demo option; this is not a production shipping agreement.
5. Create the payment collection, then a session using the region's configured provider. Integrate that provider's SDK according to `payment_sessions[].data`. Never mark payment successful from a frontend callback alone.
6. Complete the cart. Only `type:"order"` is successful; surface payment-required/error responses and retain the cart for retry. On timeout, retrieve the cart/order state instead of starting a duplicate purchase.
7. Fetch the order and Hash completion status. Payment authorization alone does not mean captured funds. Reconciliation may briefly lag order creation: a Hash-order 404 immediately after success should be retried with bounded backoff.

**Current payment limitation:** the manual provider `pp_system_default` is for local/demo tests only. Real customer purchases require a verified payment provider integration and live shipping/tax configuration. This change does not enable real payment collection. Manual vendor payouts remain as designed.

## Delivery/service completion

```json
{"order":{"id":"order_...","paid":true,"completed_at":null,"completion_eligible":true}}
```

When eligible, let the customer explicitly request the completion OTP. Show the returned code only to that customer and instruct them to share it with the partner **after successful delivery/service completion**. This is an in-app OTP, not SMS. Vendor verification happens in the partner portal. Refresh order status afterward. Codes expire in 10 minutes, have a 60-second resend cooldown and a five-attempt limit; issuance can be locked for 15 minutes. Show server messages; do not automatically loop OTP requests. Completion schedules the second 50% settlement; HFG never calls payout APIs.

## Partner image upload (not a customer API)

`POST /admin/hash/images`, authenticated with the vendor/admin Medusa token:

```json
{"vendor_id":"hv_...","data_url":"data:image/png;base64,..."}
```

201 response: `{"image":{"url":"https://res.cloudinary.com/...","public_id":"hash-marketplace/hv_.../...","width":800,"height":600}}`.

The portal selects a JPEG/PNG/WebP (maximum 5 MB), uploads it through Medusa, previews it, and stores `image.url` as the listing's `thumbnail` via the existing `save_product` action. Uploading alone does not save/publish a listing. Edited listings still require Hash approval. Server checks ownership, active vendor status, temporary-password changes, MIME signature, size and a shared quota of 10 upload attempts per minute per actor. Cloudinary credentials and upload signature stay server-side. No unsigned upload preset is needed. Replaced/abandoned uploads are retained; automatic Cloudinary asset deletion is not implemented.

## Backend environment to configure later

```text
HFG_USER_ONBOARD_URL=https://hfg-user-onboard.onrender.com
CLOUDINARY_CLOUD_NAME=<existing account cloud>
CLOUDINARY_API_KEY=<server-only>
CLOUDINARY_API_SECRET=<server-only>
```

Set the HFG web origin in `STORE_CORS` and `AUTH_CORS`; keep the portal origin in `ADMIN_CORS`/`AUTH_CORS`. Use separate local and hosted credentials/IDs. These settings have not been changed on any hosted service in this task.

## Integration QA

- First-use and returning HFG users, including phone-only profiles; expired/deleted HFG sessions.
- Two different HFG users cannot read each other's orders or request each other's completion OTP.
- Same HFG ID reuses its store identity; changed email does not create a second store account.
- Upload success/failure/oversize/wrong MIME; another vendor's upload request denied; submit waits for upload.
- Mixed-vendor carts rejected; suspended/rejected products unavailable; INR server totals respected.
- Provider capture failure/retry, duplicate checkout retry, and completion OTP expiry/replay.
- Logout clears local store session and cart; provider outages do not create accounts.

References: https://cloudinary.com/documentation/upload_images and the installed Medusa 2.10.1 API validators/routes. Standard Medusa responses can include additional fields; use stable IDs and check HTTP status.

## Local verification in this change

TypeScript and Medusa production build passed. Twelve upload/identity/access tests and the existing financial-policy tests passed. Local API checks verified invalid HFG sessions return 401, HFG provider cannot sign in administrators (403), and anonymous image uploads return 401. Cloudinary network calls and HFG upstream identity responses were mocked in unit tests; no hosted resources or real images were uploaded. The existing full checkout smoke script could not log in with the saved local admin credentials (401); those credentials were not reset. A full real-account checkout/upload test remains part of rollout QA.
