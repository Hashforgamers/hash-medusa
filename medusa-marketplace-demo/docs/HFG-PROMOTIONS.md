# Hash Store promotions — app integration

Backend: `https://hash-medusa.onrender.com`.

## Operations

Hash super admins: open **Promotions** in the partner portal. Create a draft, review its value and eligible listings, then **Activate**. Available controls: percentage or fixed amount off merchandise, coupon or automatic application, cart currency, selected listings (empty means all), optional start/end dates and a global redemption limit. Input dates use the operator's device timezone and are sent as UTC. The table displays dates in the configured store timezone.

To change offer terms, deactivate the old offer and create a new code. No offer is enabled merely by deploying this feature. Vendors cannot create or activate these offers. Review the commercial impact: discounts reduce the order value used for vendor earnings and commission. Delivery charges are not discounted by these controls. Existing completed orders are unchanged. Multiple eligible promotions can combine; this version has no exclusive-code setting or per-customer usage limit.

## Customer identity and headers

Use the existing HFG login exchange (`POST /auth/customer/hfg`) and resulting Medusa customer token. No new customer signup is required. Load the existing publishable key from `GET /hash-store/config`; do not hardcode it.

Send these headers to store routes:

```http
Content-Type: application/json
x-publishable-api-key: <key from config>
Authorization: Bearer <Medusa customer token>
```

Use only the signed-in customer's current cart. Never expose admin credentials or call `/admin/hash/promotions` from the customer app.

## Apply a coupon

```http
POST /store/carts/{cart_id}/promotions

{"promo_codes":["SAVE10"]}
```

Trim and uppercase coupon input. This adds the code to existing promotions. Use the returned `cart`, not an app-side percentage calculation. A successful HTTP response alone does not mean a coupon was eligible: verify the requested code appears in `cart.promotions` and has a corresponding positive adjustment in `cart.items[].adjustments`. Otherwise show “This code does not apply to this cart” and preserve the server totals. Dates, currency, product scope, status and usage budget can all make an offer ineligible.

## Remove a coupon

```http
DELETE /store/carts/{cart_id}/promotions

{"promo_codes":["SAVE10"]}
```

The JSON request body is required. Replace local cart state with the returned cart.

`POST` with `{"promo_codes":[]}` clears entered codes and recalculates eligible automatic offers. Automatic promotions can remain applied; don't offer customers a remove button for those.

## Display and payment sequence

1. Render a coupon field with Apply and per-coupon Remove actions; disable while a request is pending.
2. Display server `item_subtotal`, `discount_total`, `shipping_total`, `tax_total` and `total`. Do not sum these fields blindly: tax-inclusive prices affect the breakdown. Server `total` is authoritative.
3. Render applied codes and automatic offers from `cart.promotions` and line-item adjustments. Do not fetch all admin promotions or publish private coupon lists.
4. After quantity/address/shipping/coupon changes, refresh the cart and show revised totals. Apply discounts **before** creating the Razorpay payment session.
5. If a payment session already exists, close any old Razorpay checkout and refresh/recreate the payment session through the existing checkout flow. Open Razorpay using the latest `payment_sessions[].data.id` and amount, never a previously cached Razorpay order.
6. Complete the cart only after payment as described in `HFG-RAZORPAY-CHECKOUT.md`. Handle errors and refresh eligibility; adding a code is not a reservation of campaign budget. Do not automatically retry a payment or completion with an uncertain result.

Medusa amounts are major currency units (e.g. `25.5` means ₹25.50); Razorpay's order `data.amount` is paise. Never multiply a Razorpay amount a second time. Current Razorpay checkout requires a positive INR total: do not launch Razorpay for a zero-total cart; show a clear support message. Operations should avoid offers that make an order free until a separate free-order checkout is supported.

The backend is ready independently of an app release. Coupon entry/removal UI must be shipped by the app team. Automatic discounts are reflected by Medusa's cart calculations; the app still needs to display those totals correctly.

## Operations API (super-admin only)

- `GET /admin/hash/promotions?offset=0`: `{promotions,count,offset,limit}` (100 per page).
- `POST /admin/hash/promotions`: create draft:

```json
{"action":"create","definition":{"code":"SAVE10","discount_type":"percentage","value":10,"currency_code":"inr","automatic":false,"product_ids":[],"starts_at":null,"ends_at":null,"usage_limit":100}}
```

- Activate/deactivate using the latest returned `updated_at`:

```json
{"action":"state","id":"promo_...","status":"active","updated_at":"2026-10-29T00:00:00.000Z"}
```

Use `inactive` to deactivate. Stale updates, ended campaigns and exhausted budgets are rejected. State changes and creation are audited. Native Medusa promotion workflows own eligibility and order adjustments.

Reference: https://docs.medusajs.com/user-guide/promotions/create . This integration targets installed Medusa 2.10.1; newer documentation includes capabilities not exposed here.
