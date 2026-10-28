# Delhivery shipping in Hash

Hash Operations and vendors use **Shipping** in the partner portal. The connector uses the live Delhivery One B2C API for Indian prepaid physical-product orders in INR, one packed parcel per order. Services and vendor-direct checkout orders are excluded.

## Operations setup

1. Shipping → Connect Delhivery: enter the live token. Hash verifies API access and stores it encrypted, never returning it to the browser. Enable the connection separately. Token replacement disables it until re-enabled.
2. Register each vendor's pickup address in Delhivery One. Assign its exact, case-sensitive pickup-location name and pincode to that vendor in Hash Shipping. This assignment does not itself register a warehouse with Delhivery.
3. Vendors enter packed weight, dimensions, invoice number, e-waybill when applicable, and Surface/Express service. Hash checks prepaid destination serviceability and obtains a rate estimate.
4. In Orders, the vendor accepts the order, marks Processing, then Ready to Ship. The vendor explicitly books the quoted shipment. The quote expires after 15 minutes and an address/item change requires a fresh quote. The booking transmits the customer's address/phone to Delhivery. It may incur a real carrier charge.
5. The **Book Delhivery pickup** action creates the AWB and requests collection for the selected date at 2 pm India time. Download the **Carrier PDF label**. The earlier Hash A6 address sticker is still available but does not replace a carrier label with the required barcode. Review both delivery and pickup addresses before booking. An edited pickup address creates a shipment-specific registered warehouse, without changing other orders. Rescheduling and shipment cancellation remain in Delhivery One.

## Delivery payer and actual charges, no markup

The vendor owner chooses Customer pays or Seller pays in Shipping. The default is Seller pays. Customer-paid checkout uses saved packed-unit weight/dimensions and quantity to obtain a live Surface estimate; seller-paid checkout is ₹0. See [app integration guide](HFG-DELIVERY-CHECKOUT.md). The order retains its payer and collected delivery amount. Collected shipping is credited to vendor earnings without platform commission; the actual courier charge is then deducted. Any difference is a vendor adjustment, never an automatic extra customer charge.

The quote API provides estimates, not final invoiced charges. Quotes are never posted as actual vendor fees. Once booked (including an uncertain booking), the order's remaining payouts are held pending final shipping-invoice reconciliation.

Hash Operations → Shipping → Reconcile invoice records the **actual total courier charge including tax**, invoice/credit-note reference and evidence note. Enter the full cumulative net billed amount for this shipment, including any applicable adjustments/return fees; do not enter just the difference. The record is revision-checked and audited. Only super admins can reconcile charges.

The exact charge reduces remaining vendor settlement amounts; there is no markup. Previously paid amounts and their transfer references are immutable. If charges/refunds exceed the available order earnings, the order shows a recovery balance for Hash to collect separately. No cross-order collection or bank debit happens automatically. A corrected invoice or carrier credit can lower the charge, including to zero. Processing bank transfers must be resolved before editing invoice charges.

This implementation does not download final carrier invoices automatically. The public Calculate Shipping Cost API is an estimate endpoint. Final amounts must be reconciled from the account's invoice; future invoice import can use the same audited ledger.

## Tracking and duplicates

Tracking sync runs every 15 minutes for recent shipments, with a manual Refresh carrier tracking button. Only the stored order reference and waybill are accepted. Carrier delivery is a timeline event `carrier_delivered`; **customer OTP remains required** to mark Hash delivery complete and release the completion milestone. `return_in_progress` and `carrier_update` are additional timeline states. The HFG app uses the existing `GET /store/hash/orders/:id` tracking response; no hfg-user-onboard changes are required.

A booking claim is persisted before calling Delhivery. A timeout/ambiguous response stays `booking` and cannot be booked again. Refresh tracking can recover its waybill by order reference. If Delhivery confirms no shipment exists, an administrator may use Resolve missing booking with evidence, then obtain a fresh quote. Never reset a booking merely because a request timed out. Check in Delhivery One first.

## API for portal integrations

Authenticated vendor/super-admin routes: `GET /admin/hash/shipping`, `POST /admin/hash/shipping`. Vendor responses and actions are scoped to their business. Changing temporary passwords is required before any mutation. GET responses and labels use `Cache-Control: no-store`.

POST actions:
- `settings`: super admin; `token`, current `revision` (0 initially).
- `enabled`: super admin; `active`, `revision`.
- `payer`: vendor owner/super admin; `vendor_id`, `payer` (`seller` or `customer`), current `shipping_policy_revision` as `revision`.
- `pickup`: super admin; `vendor_id`, registered pickup `name`, `pincode`.
- `quote`: `order_id`, `parcel: {weight_g,length_cm,width_cm,height_cm,mode,invoice,ewaybill}`.
- `book`: `order_id`, quote `revision`, `confirmed:true`.
- `sync`, `label`: `order_id`.
- `invoice`: super admin; `order_id`, shipment `revision`, `amount_paise`, `reference`, `note`, `confirmed:true`.
- `reset_booking`: super admin; `order_id`, evidence `note`, `confirmed:true`.

`label` returns a temporary carrier PDF URL containing recipient information. Treat it as private and never log/publish it. Tokens must remain server-side.

Official contracts: [Delhivery B2C API documentation](https://one.delhivery.com/developer-portal/documents/b2c/), [shipment creation](https://one.delhivery.com/developer-portal/document/b2c/detail/order-creation), [tracking](https://one.delhivery.com/developer-portal/document/b2c/detail/order-tracking).

## Simplified dispatch
Orders shows **Accept order → Start processing → Ready to ship → Book Delhivery pickup**. Parcel measurements come from listing packed-unit measurements; courier selection is automatic (Delhivery Surface). Review both addresses and select pickup date. Address edits are frozen after booking. Orders requiring an e-waybill must supply it before dispatch.

`POST /admin/hash/shipping` actions:
- `prepare_dispatch`: `order_id`, optional `delivery_address`, `pickup_address`. Address fields: first_name, last_name, address_1, address_2, city, province, postal_code, phone, country_code (`in`). Returns shipment revision/estimate, pickup and delivery_address.
- `dispatch`: `order_id`, `revision`, `pickup_date` (YYYY-MM-DD, within 30 days, minimum one hour before 14:00 Asia/Kolkata), optional `ewaybill`, `confirmed:true`.
- `resolve_dispatch`: Hash super admin only; `kind` location/pickup, `id`, `outcome` confirmed/absent, evidence `note`, `confirmed:true`; confirmed pickup additionally requires `carrier_id`. Only unresolved requests older than two minutes are eligible.

Pickup requests are shared per location/date and durably linked to shipments. Retries reuse existing claims. Uncertain responses require verification in Delhivery One and resolution in Hash Operations → Shipping → Carrier confirmations needing review. Never mark absent based only on a timeout.

Actual charges remain reconciled from courier invoices without markup. Address changes do not recharge the customer; differences are reconciled with vendor earnings. No payment or shipment is created by automated tests.
