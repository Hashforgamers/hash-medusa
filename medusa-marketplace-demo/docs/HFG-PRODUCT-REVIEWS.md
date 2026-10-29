# Hash Store customer reviews — app integration

Base URL: `https://hash-medusa.onrender.com`.

## Identity and availability

Reuse the existing HFG user login exchange (`POST /auth/customer/hfg`) and Medusa customer bearer token. No changes to `hfg-user-onboard` are required. All `/store` routes require `x-publishable-api-key` from `GET /hash-store/config`. Customer-only routes additionally require `Authorization: Bearer <Medusa customer token>`.

A customer can review only an item in their own paid order after OTP-confirmed delivery/service completion. One review is allowed per customer per product, including repeat purchases. Refunds after completion do not automatically remove reviews or prevent honest feedback. Ratings from 1 through 5 are equally eligible for publication.

The backend and Operations UI are implemented; the mobile app team must ship the review form, list, status and edit/withdraw controls.

## Product details: published reviews and rating

```http
GET /store/hash/products/{product_id}/reviews?offset=0&limit=20
x-publishable-api-key: <key>
```

No login is needed for this route. Response:

```json
{
  "reviews": [{"id":"hr_...","rating":4,"title":"Good product","body":"Worked well for my setup.","author":"Verified buyer","verified_purchase":true,"created_at":"...","updated_at":"..."}],
  "count":1,"offset":0,"limit":20,
  "rating_summary":{"count":1,"average":4,"breakdown":{"1":0,"2":0,"3":0,"4":1,"5":0}}
}
```

Only approved reviews for active, approved, published listings are returned. Customer names, emails, IDs, order IDs and moderation notes are never public. Render titles and bodies as plain text, never HTML. Empty reviews return count/average `0`; display “No reviews yet” instead of zero stars.

Product cards from `GET /store/hash/products` now include `rating_summary: {count,average}` per product. Existing fields remain unchanged.

## Order details: enable Write a review

```http
GET /store/hash/reviews/eligibility?order_id=order_...&product_id=prod_...
Authorization: Bearer <customer token>
x-publishable-api-key: <key>
```

Returns `{"eligible":true,"reason":null}` or `{"eligible":false,"reason":"..."}`. A foreign/missing order returns 404. Show Write a review only for eligible purchased items. Check the customer's existing review to decide whether to offer Edit instead.

## My reviews

```http
GET /store/hash/reviews?product_id=prod_...&offset=0&limit=20
```

Authenticated route. `product_id` is optional; omit it to list the customer's reviews. Returns `{reviews,count,offset,limit}`. Each record includes `id`, `product_id`, `order_id`, `rating`, `title`, `body`, `status`, `revision`, `moderation_note`, `created_at`, `updated_at`. Includes pending, approved, rejected and withdrawn records owned by this customer only.

Status labels:

- `pending`: Awaiting moderation; not public yet.
- `approved`: Published.
- `rejected`: Not published; show `moderation_note` and allow editing.
- `withdrawn`: Removed by you; allow resubmission using its current revision.

## Submit / edit

```http
POST /store/hash/reviews
Content-Type: application/json

{"product_id":"prod_...","order_id":"order_...","rating":4,"title":"Good product","body":"Worked well for my setup."}
```

Returns `{"review":{...}}`, initially `pending`.

For edits/resubmission, send the same fields plus the latest `revision`. The server derives customer identity from the token; do not send `customer_id`, `status` or `verified_purchase`. Rating must be an integer 1–5; title is optional up to 120 characters; body must be 10–3000 characters after trimming. Product/order IDs must be from the current customer's actual order.

An edit removes the old published version from public results and resets moderation. On 409, refresh My reviews before offering another save; never overwrite a newer version silently. A second create for the same product also returns 409. Disable Save while submitting.

## Withdraw

```http
DELETE /store/hash/reviews/{review_id}
Content-Type: application/json

{"revision":3}
```

Authenticated owner only. This soft-withdraws the review, immediately removing it from public ratings/results. It remains in My reviews and the moderation audit history. A withdrawn review cannot be republished by an administrator; the customer must resubmit it. Keep the returned revision for future resubmission.

## Moderation

**Hash Operations → Reviews** provides Pending / Approved / Rejected / Withdrawn / All filters, pagination, full review content and Publish / Reject / Hide actions. Rejections/hides require a reason that is visible to the review author. All moderation actions are audited. Moderate spam, abuse, privacy violations and irrelevant content consistently, rather than suppressing low ratings.

Vendors see only approved reviews for their own listings and cannot publish, hide or change customer reviews. Listing approval and customer-review moderation are separate workflows.

Super-admin API:

```http
GET /admin/hash/reviews?status=pending&offset=0&limit=20
POST /admin/hash/reviews

{"id":"hr_...","revision":1,"status":"approved","note":""}
```

Use `status: "rejected"` and a reason of at least five characters to reject or hide. Stale revisions return 409. Customer edits racing with moderation cannot accidentally publish an unreviewed version. Admin credentials must never be embedded in the customer app.

## App acceptance checklist

- Existing HFG user signs in, sees ratings and approved reviews.
- Unpurchased, unpaid or uncompleted items cannot be reviewed.
- A completed purchased item can receive one review.
- Pending reviews are shown only in My reviews and Operations.
- Editing an approved review hides it until re-approved.
- Withdraw removes the review and updates rating totals.
- Invalid/expired login, ineligible purchase and stale revision errors are shown clearly.
