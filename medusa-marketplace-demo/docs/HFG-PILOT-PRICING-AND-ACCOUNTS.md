# Founding Partner pilot: app and Operations handoff

## Agreed pilot

90 days per partner, 3% seller commission, ₹10 customer platform fee **inclusive** of applicable GST, and Hash pays gateway charges. Listing/onboarding fees remain zero. Delivery continues to follow the seller/customer policy. No 8–12% rate is automatically assumed.

Configure **Partner businesses → Pricing & pilot**. Enter the activation date, agreed terms/reference, tax rate for the inclusive platform fee breakdown, and optionally agreed post-pilot/category rates. Save as a draft until app checkout displays the fee separately. Activating terms applies them to newly quoted checkouts; existing order snapshots are immutable. If no regular rate is agreed, the pilot rate continues after day 90 and is flagged for review. If an item has several configured categories, the lowest agreed category rate applies. Category percentages are applied to discounted product selling values including product tax, excluding delivery and platform fees.

The seller listing form previews one unit, without discounts or an address-dependent delivery quote. It shows listing price, customer fee, checkout before delivery, commission and seller proceeds before courier charges. Gateway estimates are illustrative; actual financial reporting only uses provider-reported fees.

## App integration (required before activating the customer fee)

Use the existing publishable API key and authenticated HFG customer → Medusa token exchange. No HFG identity backend change is needed. All monetary `*_minor`/`*_paise` fields are integer minor currency units (INR paise). Native Medusa `cart.total`/shipping `amount` remain major currency units.

1. Create/update the cart and customer address normally.
2. `GET /store/hash/carts/{cart_id}/delivery` with customer bearer token and publishable key. New fields:
   - `platform_fee_minor` — current fee (e.g. 1000).
   - `platform_fee_tax_inclusive: true`.
   - `shipping_selection_required` — also true for services with commercial terms.
   - existing `shipping_option_ids`, payer and package requirements remain.
3. Fetch/calculate native shipping options and select the Hash calculated option with `POST /store/carts/{cart_id}/shipping-methods` `{ "option_id": "..." }`, **including service orders when required**.
4. Refetch the delivery endpoint. Its accepted `quote` contains:
   ```json
   { "amount_paise": 0, "platform_fee_minor": 1000,
     "combined_charge_minor": 1000, "platform_fee_tax_inclusive": true }
   ```
   `amount_paise` is delivery only. Display separate **Delivery** and **Hash platform fee (GST inclusive)** rows. The native calculated shipping-method amount includes both charges for payment-total consistency. **Do not add the fee again to cart.total**, and do not label the combined native amount as courier charges. Use the accepted quote, not a hardcoded ₹10.
5. Use native `cart.total` for the final payable total and Razorpay payment collection/session. The backend rejects missing/stale delivery selection **before creating the payment session**, as well as at completion. Re-select delivery after cart/address changes. Keep the existing Razorpay payment and completion flow.
6. Order shipping-method data preserves `hash_customer_shipping_paise` and `hash_platform_fee_paise` for separate order-history rows. The account statement stores agreed fee/commission snapshots independently.

The configured platform GST percentage splits an inclusive fee for financial reporting; it does not install a GST tax provider or replace native Medusa tax/invoice configuration. Configure native tax rules consistently before issuing tax invoices. Hash commission GST, withholding and other new deductions are not introduced by this release.

## Partner accounts and Operations

**Earnings & payouts** includes currency-separated summaries, partner/date filters, paginated order statements, CSV export, payout schedules, bank references and dated account activity. Date filters select orders by creation date, not a historical balance as of the end date. Existing records get explicitly labelled opening snapshots at migration time; earlier events are not fabricated.

- `GET /admin/hash/accounts?vendor_id=...&from=...&to=...&offset=0&limit=25`
- `GET /admin/hash/accounts?order_id=...` includes `detail.order`, `detail.settlements`, `detail.history`.
- Admin user bearer token required; partners are always scoped to their own account regardless of supplied vendor ID. The app customer token cannot use these administration endpoints.
- Full totals include all matching orders, not only the current page or the older 500/1000 dashboard limits.
- Customer refunds hold unpaid balances until Operations reviews them. For pilot orders, reviewed monetary refunds proportionally reduce the original customer platform fee and commission; no current vendor rate is reapplied. Delivery invoices remain actual charges. Refund allocation must match the commercial agreement.
- Unknown gateway fees display as pending; never deduct the 2.36% estimate from the vendor. Actual Razorpay `payment.fee` includes its tax; `payment.tax` is stored separately and **not added again**.
- Manual payout: open the order statement and record the completed bank transfer's unique UTR/reference. This records a transfer; it does not initiate one.

## Optional payout automation

**Partner businesses → Payout automation** is off by default. To enable, assign an active connector, verify the bank account and set a rolling 24-hour limit in bank currency. Enabling authorizes sending due scheduled transfers every five minutes. Existing payment/OTP timing, holds, final courier invoices, bank currency, provider status and transfer idempotency remain enforced.

Provider assignment or replacement bank details disables automation. Failed/ambiguous transfers are not automatically retried. An asynchronous provider response remains processing until verified in Payment & payout setup; full automatic confirmation requires a provider-specific webhook/status integration. No live payout is executed as part of deployment or testing.

Provider field reference: [Razorpay Payments Entity](https://razorpay.com/docs/api/payments/entity/) documents `fee` and `tax`; the illustrative estimate uses [published pricing](https://razorpay.com/pricing/), not a promise about this merchant's contracted rate.
