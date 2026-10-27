# HFG app handoff: delivery fees, tracking and labels

Backend: `https://hash-medusa.onrender.com`. Portal: `https://partners.hashforgamers.com`.
No changes to **hfg-user-onboard** are needed. Use the existing Hash-to-Medusa login exchange; the app needs the changes below. Never include Delhivery, Razorpay secret keys or admin credentials in the app.

## Authentication

1. `GET /hash-store/config` without headers returns `publishable_api_key`, `region_id`, `sales_channel_id`, `currency_code` and `country_code`.
2. `POST /auth/customer/hfg`, JSON `{ "token": "HFG_APP_BEARER_TOKEN" }`, returns the Medusa customer JWT. Use the HFG token accepted by `/api/users`, not a Firebase ID token.
3. On first login only, if JWT lacks `actor_id`, register through `POST /store/customers` with this JWT and publishable key, then exchange again. See [full customer registration contract](HFG-STORE-API.md).
4. All following store requests use `Authorization: Bearer <medusa_customer_jwt>` and `x-publishable-api-key: <returned_key>`. JSON writes also use `Content-Type: application/json`.

## Cart and delivery selection — before payment

One vendor per cart, INR/India initially. Create the cart using the returned region/channel, add items, and save the complete recipient address and phone with `POST /store/carts/:id`. Save `shipping_address` including first_name, last_name, address_1, address_2, city, province, postal_code, country_code (`in`) and phone.

1. `GET /store/hash/carts/:id/delivery` gives the owning customer's cart policy:

```json
{
  "vendor_id": "hv_example", "vendor_name": "Example Store",
  "payer": "customer", "currency_code": "inr",
  "provider_id": "hash_delivery_hash_delivery",
  "shipping_option_ids": ["so_example"],
  "missing_package_product_ids": [], "quote": null
}
```

`payer` is `customer` or `seller`. Services have no delivery fee. Missing package IDs identify listings whose seller must add packed unit weight/dimensions before customer-paid quotes work. Do not substitute zero or invent measurements.

2. `GET /store/shipping-options?cart_id=CART_ID` returns options available for that cart/address. Select the option whose `provider_id` is `hash_delivery_hash_delivery`. Do not hardcode its `so_` ID or select an arbitrary legacy free method. No applicable option means unavailable delivery; block payment.
3. `POST /store/shipping-options/:option_id/calculate` with `{ "cart_id":"cart_...", "data":{} }` returns `shipping_option.amount` (INR rupees) and `shipping_option.calculated_price.calculated_amount`. A bare list response is not a calculated quote.
4. Show “Delivery paid by seller” and ₹0 for seller-paid orders; otherwise show the returned delivery amount for acceptance. `POST /store/carts/:id/shipping-methods` with `{ "option_id":"so_...", "data":{} }` selects it. The backend generates the trusted quote data; clients must not supply prices, quote IDs or payer overrides.
5. Use the returned cart's `shipping_total`, `tax_total`, `total` and `currency_code` for the final confirmation. Show the final total **before** opening Razorpay. Selection recalculates if the estimate expired; if the amount differs, ask the customer to accept the final total.
6. Only now create a payment collection/session and open Razorpay. Follow [Razorpay checkout](HFG-RAZORPAY-CHECKOUT.md). Medusa money is in rupees; custom `amount_paise` and Razorpay session `data.amount` are in paise. Never multiply Razorpay amount twice.
7. After changing items, quantity or address, repeat delivery selection and create a matching payment session before paying. After successful payment, retry completion of the same cart/session; do not reselect shipping or charge again merely because completion timed out.

Quotes are cached for 15 minutes. An accepted quote is retained for checkout validation even if another quote is fetched. Item/address changes invalidate it. Vendor policy changes apply to new selections. Existing orders retain their payer and collected delivery amount.

The estimate uses saved packed unit weight/dimensions and quantity, with one parcel estimated as maximum length, maximum width and summed heights. It is an estimate, not a packing optimisation. Current limits: one parcel, 30 kg, 150 cm per dimension, prepaid India/INR, Surface at checkout. Final courier weighing may differ; no extra customer charge is taken automatically. The difference is reflected in the seller settlement.

## Customer order tracker

Use `GET /store/orders` for history and `GET /store/orders/:id` for items, address and totals. Use **`GET /store/hash/orders/:id`** for the Hash delivery tracker. Full response example and UI rules: [HFG order tracking](HFG-ORDER-TRACKING.md).

| Value | App label |
| --- | --- |
| placed | Order placed |
| preparing | Preparing your order |
| shipped | Shipped |
| out_for_delivery | Out for delivery |
| delivery_attempted | Delivery attempted |
| delivered | Delivery confirmed |
| ready_for_service | Ready for service |
| in_progress | Service in progress |
| completed | Service completed |
| canceled | Order canceled |

Render `tracking.timeline` in timestamp order, including repeated updates. `carrier_delivered` is a timeline event: “Courier reports delivered — awaiting OTP”. It does not mean final Hash completion. `return_in_progress` and `carrier_update` are additional carrier events. Display `on_hold` separately. Render notes as plain text and open only HTTPS tracking links.

Poll every 30 seconds while visible, refresh on foreground/pull-to-refresh, back off on errors, and stop polling in background. Delhivery sync runs approximately every 15 minutes; this is not live GPS or push notification delivery. A new order can briefly return 404 while reconciliation finishes. Network errors never mean canceled.

When `order.completion_eligible` is true, offer **Show completion OTP**: `POST /store/hash/orders/:id/otp` with `{}` returns `{code, expires_at, instruction}`. Show the code only to its logged-in customer; do not log it. The customer shares it with the vendor only after receiving the goods/service. Vendor verification completes delivery and releases the completion milestone. The customer app never calls admin OTP verification.

## Vendor and operations responsibilities

In partner **Shipping**, the owner chooses **Customer pays delivery charges** or **Seller pays delivery charges**. On Listings, save packed-unit grams and dimensions in centimetres. Hash Operations assigns the registered Delhivery pickup name/pincode. No code change is needed for these settings.

Vendor books the shipment explicitly, downloads its carrier PDF label, and schedules pickup in Delhivery One. Orders → Details also has an A6 address sticker with recipient contact/address. Both are private vendor tools, not customer-app APIs. Carrier labels and customer addresses must never be public assets.

Hash Operations reconciles the actual invoice without markup. Customer shipping collected is credited to the order's vendor earnings without platform commission; actual carrier costs are deducted. Seller-paid orders collect ₹0 shipping and deduct the full actual charge from seller earnings. Remaining payouts wait for invoice reconciliation after booking. Existing paid transfers stay immutable; excess costs create a recovery balance.

## App release checklist

Test seller-paid ₹0, customer-paid quoted fee, quantity/address change, unavailable pincode, missing package dimensions, shipping-inclusive Razorpay total, completion retry without double charge, own-order history/tracking, cross-customer denial, attempted delivery, carrier-delivered awaiting OTP, and final OTP completion. Do not test by charging a real customer or booking a real shipment without approval.
