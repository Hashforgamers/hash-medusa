# HFG app: manual order tracking and shipping labels

The partner or Hash Operations updates non-integrated shipments manually. Delhivery orders now support periodic carrier status import (see below). No courier webhook, live GPS, SMS or push notification is configured. App engineers should poll the customer's order while the tracking screen is open, and show new timeline entries as in-app updates. A carrier-reported delivery does not replace customer OTP confirmation.

## Customer API

Use the existing Medusa customer bearer token from HFG login and `x-publishable-api-key` from `GET /hash-store/config`. No changes to hfg-user-onboard are required.

`GET /store/hash/orders/:id` keeps its existing `order` response and adds `tracking`:

```json
{
  "order": { "id": "order_...", "paid": true, "completed_at": null, "completion_eligible": true },
  "tracking": {
    "order_id": "order_...", "kind": "product", "status": "shipped", "revision": 2,
    "paid": true, "on_hold": false, "completion_eligible": true,
    "courier": "Vendor courier", "tracking_number": "AWB123",
    "tracking_url": "https://courier.example/track/AWB123", "expected_delivery": "2026-11-01",
    "timeline": [
      {"id":"placed","status":"placed","at":"2026-10-27T08:00:00Z","note":"Order placed"},
      {"id":"paid","status":"payment_confirmed","at":"2026-10-27T08:01:00Z","note":"Payment confirmed"},
      {"id":"42","status":"shipped","at":"2026-10-28T09:00:00Z","note":"Handed to the courier","courier":"Vendor courier","tracking_number":"AWB123","tracking_url":"https://courier.example/track/AWB123","expected_delivery":"2026-11-01"}
    ]
  }
}
```

- Products: `placed → accepted → preparing → ready_to_ship → shipped → out_for_delivery → delivered`.
- Display product stages as New Order, Accepted, Processing, Ready to Ship, Shipped, Out for delivery and Delivered. Vendor acceptance confirms stock/order details. Booking an AWB alone does not mean the courier collected the package.
- A delivery attempt may be recorded after shipped or out_for_delivery. `delivery_attempted → out_for_delivery` records another attempt.
- Services: `placed → preparing → ready_for_service → in_progress → completed`.
- `delivered`/`completed` are generated only after successful customer OTP verification. Existing completion eligibility is retained so a valid direct handoff can complete without fabricating intermediate events.
- `canceled` comes from actual Medusa order cancellation; `on_hold` indicates a payment/refund/order review hold. Display the hold separately rather than suggesting progress.
- Expected date is a date-only estimate supplied by the vendor, not a guarantee. Timeline timestamps are UTC; display using the app's selected timezone.
- Timeline may contain repeated stages when a note or tracking information changes. Render notes as plain text. Treat the timeline as authoritative; don't invent timestamps for missing stages.
- Refresh every 30 seconds while the screen is visible, on foreground, after OTP completion and on pull-to-refresh. Stop polling on background; back off on errors. A newly placed order can briefly return 404 until reconciliation finishes. Never interpret a network failure as cancellation.
- Only the owning customer can read the endpoint. Other customers receive 404. No vendor settlement, banking or OTP-secret data is returned.
- `revision` protects vendor edits; completion and cancellation can change without incrementing it, so do not skip refreshing just because revision is unchanged.

Continue to use `GET /store/orders` for history and `/store/orders/:id` for line items and order totals. These manual Hash stages do not create Medusa fulfillment records, buy shipping, allocate courier labels or change inventory. Use `tracking.status` for the Hash tracker instead of inferring delivery from payment or Medusa's fulfillment status.

## Partner / Hash Operations

Orders → Details → Update tracking. Only the owning active vendor or a Hash super admin can change a record. Sequential stage transitions, payment/hold checks and revision checks are enforced on the server. Notes are visible to the customer. Editing the same stage is allowed for a corrected courier/link/date or new note. No manual Delivered button is provided.

`POST /admin/hash` with action `update_delivery`, `order_id`, `revision`, `status`, `courier`, `tracking_number`, `tracking_url`, `expected_delivery`, `note`. All text fields are bounded; tracking URLs must use HTTPS. Obtain current revision and details from `GET /admin/hash?order_id=...`. On conflict refresh rather than retrying stale input.

## Shipping sticker

Orders → Details provides **Print / save PDF label** and **Download label (HTML)** for physical product orders. Printing opens a separate tab and the browser print dialog; choose Save as PDF for a PDF copy. The label uses A6 paper, with recipient name/address/phone, sender business/return contact, order reference, item count, courier and tracking number. Populate the partner's business address/contact before dispatch. An unpaid/held/canceled order is explicitly labeled “Do not dispatch”. Shipping address is required.

`POST /admin/hash` with `{ "action":"shipping_label", "order_id":"order_..." }` returns `{ "result": { "html":"...", "filename":"hash-label-123.html" } }`. It is authenticated, vendor scoped, audited, non-cacheable, and requires any temporary password to have been changed. Never publish this endpoint or generated files: labels contain recipient personal information. It contains no customer OTP, bank details or settlement amounts.

This is an address sticker, **not a purchased courier shipping label**. The vendor must arrange postage and use any label the courier requires. For Delhivery orders, use the carrier PDF label from Shipping.

## Delhivery integration

Orders booked through Hash Shipping now import Delhivery tracking approximately every 15 minutes. Manual tracking remains for other couriers; managed Delhivery orders use carrier refresh. Render `carrier_delivered` as "Courier reports delivered — awaiting OTP", `return_in_progress` as a return update, and `carrier_update` as a carrier update. These are timeline events; only successful customer OTP changes the final Hash status to delivered. See [Delhivery operations and fee guide](DELHIVERY.md). No courier API token or vendor shipping-charge controls belong in the customer app.
