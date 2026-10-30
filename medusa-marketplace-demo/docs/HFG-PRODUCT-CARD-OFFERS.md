# Product cards: offers and price breakdown

Use `GET /store/hash/products?currency_code=inr&limit=20&offset=0` with `x-publishable-api-key`. Existing category/vendor filters still work. The response adds `pricing` and `offers` to each product; existing `price_inr` and `prices` remain unchanged base listing prices.

Example for a ₹10 product with an active automatic 30% discount:

```json
{
  "price_inr": 10,
  "pricing": {
    "currency_code": "inr",
    "original_amount": 10,
    "discount_amount": 3,
    "calculated_amount": 7,
    "original_amount_minor": 1000,
    "discount_amount_minor": 300,
    "calculated_amount_minor": 700,
    "discount_percent": 30,
    "quantity": 1,
    "is_estimate": true,
    "excludes_platform_fee": true,
    "excludes_delivery": true,
    "tax_calculation": "not_address_specific"
  },
  "offers": [{
    "code": "DIWALI-SALE",
    "automatic": true,
    "requires_code": false,
    "discount_type": "percentage",
    "value": 30,
    "discount_amount": 3,
    "price_after_discount": 7,
    "discount_amount_minor": 300,
    "price_after_discount_minor": 700,
    "preview_quantity": 1,
    "starts_at": "2026-10-29T14:16:00.000Z",
    "ends_at": "2026-11-03T14:16:00.000Z"
  }]
}
```

Card mapping:
- Main product price: `pricing.calculated_amount` (₹7).
- Strike-through price: `pricing.original_amount` (₹10), only if the discount is positive.
- Offer badge: `pricing.discount_percent` (30% off).
- Savings: `pricing.discount_amount` (save ₹3). **₹3 is not the selling price.**
- No offers: calculated price equals the original price; do not show a strike-through or discount badge.
- Missing currency price: `pricing: null`, `offers: []`; do not invent a conversion or price.

Only eligible **automatic** promotions change the default card price. Explicit coupon offers have `requires_code: true`; show the code/action separately and use the existing cart-promotion endpoint if the customer chooses it. Individual entries in `offers` preview that offer in isolation; never add their discount amounts together. `pricing` uses Medusa's own engine to compute the combined automatic discount.

Inactive, expired, future and exhausted campaigns are excluded. Customer/basket-dependent, shipping and buy/get offers are not advertised as unconditional single-item prices. Final eligibility, stock, tax, quantity and promotion budget are recalculated by the real cart. The card price excludes platform and delivery fees; use the cart delivery breakdown and native `cart.total` at checkout. Never add a platform fee to every product card.

The native `/store/products` response is not modified by this extension. Use `/store/hash/products` for Hash card offers and rating summaries. No HFG user-onboarding backend changes are required.

## Hash Operations controls

Open **Store settings → Pricing, fees & payout controls** (also available under Partner businesses):
- Customer platform fee, including a zero-fee policy; inclusive-fee GST breakdown.
- Pilot commission/duration/start date, agreed regular rate and category overrides.
- Gateway cost and GST **estimates** used for planning. Actual Razorpay fees remain authoritative and Hash-funded during the pilot.
- Minimum and maximum individual automatic transfers, plus the rolling 24-hour limit. Amounts outside these limits require manual review; they are not silently deducted or forfeited.
- Existing Payment & payout setup still manages milestone percentages, delays, business-day calendars and provider connections.

These controls do not automatically activate pilot charging or external payouts. Existing orders keep their snapshots.

Marketplace references used for the control structure, not copied rate cards: [Amazon seller fees](https://sell.amazon.in/fees-and-pricing), [Flipkart seller fees](https://seller.flipkart.com/fees-and-commission), [Meesho pricing](https://supplier.meesho.com/pricing). Hash's agreed charges remain its own commercial policy.
