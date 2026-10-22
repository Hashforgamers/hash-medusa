# Hash Operations settings and partner payouts

This change is local until deployed. INR/India remains the default. It adds no payment gateway subscription, currency conversion or automatic bank transfers.

## Super-admin controls

Open **Operations Settings** in the Hash portal:

- **Store & support:** store name, support email/phone, returns policy and shipping/service policy. These are published through the public bootstrap response for the app team.
- **Currencies:** enable a currency from Medusa's currency list. Existing currencies and INR default are preserved. Configure listing prices explicitly; values are never converted automatically.
- **Markets & payments:** create/edit regions, select countries and installed enabled payment providers, and enable/disable automatic tax calculation. A country cannot be moved silently out of another region. Existing region currency cannot be changed because existing carts retain their currency. Tax calculation still requires correctly configured tax rates/providers.
- **Delivery rates:** create/update a flat delivery charge per region, using its currency. India updates the existing standard option. New region rates create service zones on the primary fulfillment location. After adding countries to a region, save its delivery rate again to update shipping coverage.
- **Fulfillment locations:** add locations and edit full addresses, postcode and phone. Locations are linked to the marketplace sales channel. Listing stock and the managed delivery options continue using `Hash Fulfilment`; advanced stock allocation and fulfillment providers at additional warehouses remain in Medusa Admin.

To enable a new market: add currency → create region/countries and choose an installed payment provider → set delivery fee → enter a price in that currency on each listing → approve the edited listings → test checkout and configure a matching payout account. Listings without the selected currency cannot be checked out. Selecting the manual/demo payment provider does not collect real money. New real payment providers require backend installation and credentials before appearing in the selector.

Settings changes are audited. Only Hash super admins can read or change settings. Temporary-password accounts must change their password before writes or bank access.

## Partner onboarding

**Partners → Onboard partner** collects:

- Trading name and owner login email.
- Legal name, contact person/phone/email, tax/GST ID, registration number, business address and country.
- Commission and collection arrangement; existing 50/50 and T+1 IST rules are unchanged.
- Account holder, bank and branch, account type, account number and confirmation, bank country/currency, IFSC for India, and SWIFT/BIC, IBAN or routing information for international payouts.
- Beneficiary address, payout email and instructions. The payout email is stored for operations; notification sending is not implemented.

Legacy partners can retain their existing payout notes and add a structured bank account using **Replace bank**. Bank account numbers remain strings so leading zeroes are preserved. Submitted confirmation is discarded after validation. Bank format checks do not verify actual bank-account ownership.

## Bank review and payouts

Partner lists show only bank name, account ending and currency. Partner staff receive neither bank details nor business/contact or legacy payout notes. Owners can see the masked summary. Only Hash super admins can reveal complete structured bank details, with a review reason recorded in the audit trail.

**Review bank → Confirm bank details verified** records a manual operator review. It does not contact a bank or perform a penny-drop verification. Verify against the partner's supplied documents before confirming. Replacement bank details reset verification. A revision check prevents a stale review from verifying an account changed by another operator.

Recording a payout now requires:

1. A fully populated, manually verified bank account.
2. Bank payout currency equal to the order/settlement currency.
3. The existing active-partner, due-date, payment capture, refund/hold and unique-reference checks.

Manual payouts still only record transfers already made outside the portal. No money is sent. One bank account is configured per partner; multi-currency partners must arrange a matching-currency bank account before recording each payout. FX conversion and multiple concurrent beneficiary accounts are not implemented.

Amounts in legacy `*_paise` fields now represent **minor units of `currency_code`**: INR/USD use 100, JPY uses 1, BHD uses 1000. Existing INR amounts remain unchanged. Each ledger row includes its currency; overview totals are grouped by currency instead of mixing currencies. The payout adapter's legacy `amountPaise` field likewise means minor units of its accompanying `currency`.

## API reference

All endpoints below require a Medusa admin bearer/session authenticated as Hash super admin:

- `GET /admin/hash/settings`: store, supported/available currencies, regions, countries, installed payment providers, stock locations and shipping options.
- `POST /admin/hash/settings`: actions `store`, `add_currency`, `region`, `location`, `shipping`. Body schema: `src/lib/hash/settings.ts`.
- `POST /admin/hash`: `onboard` and `vendor_settings` accept optional `business_details` and `bank_details`; `save_product` accepts `prices: [{currency_code, amount}]`. Legacy `price_inr` requests still work.
- `POST /admin/hash/bank`: `{action:"view",vendor_id,note}` returns `{bank_details,revision}`; `{action:"verify",vendor_id,note,revision}` confirms that exact account revision.

`GET /admin/hash` returns `currencies`, masked `bank_summary` for owners/admin, and `currency_code` on orders and settlements. The bank mutation audit never stores the complete account number. Bank details remain in the private database and authorized review response; never include them in frontend app configuration.

The storefront **public** `GET /hash-store/config` retains its v1 default fields and adds:

```json
{
  "markets": [
    {"region_id":"reg_example","name":"India","currency_code":"inr","countries":["in"]}
  ],
  "store": {
    "name":"Hash Marketplace",
    "support_email":"",
    "support_phone":"",
    "returns_policy":"",
    "shipping_policy":""
  }
}
```

The app should keep the top-level INR/India values as the default, offer only configured markets, create a separate cart when switching regions, and use the chosen region ID when fetching calculated prices and creating carts. Do not relabel an existing cart's prices as another currency.

## Migration and validation

Run normal Hash setup before starting the updated server; deployment already runs it. Migration adds business/bank/review fields to `hash_vendor` and `currency_code DEFAULT 'inr'` to `hash_order`. Setup now preserves enabled store currencies and custom store name across restarts. No user-onboarding service or database changes are required.

Validated locally: settings API; currency/region creation and updates; delivery rate create/update; location creation; structured onboarding; masking; bank verification/reset/stale-review rejection; multi-currency listing; USD checkout with shipping, capture, OTP, 50/50 settlement rounding, currency mismatch rejection and idempotent manual payout. Unit tests additionally cover zero-/two-/three-decimal currencies and permissions.

## Configurable finance extension

See [Hash finance guide](HASH-FINANCE.md) for editable settlement plans, payout connectors, Razorpay customer plans and the subscription API. The fixed 50/50 wording above describes the seeded legacy plan only; new orders use their assigned plan snapshot. Customer recurring plans are standalone billing agreements, not instalment checkout for Medusa carts.
