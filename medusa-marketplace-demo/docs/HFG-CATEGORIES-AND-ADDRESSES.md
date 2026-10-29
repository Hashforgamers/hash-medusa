# App integration: shop categories and country/state dropdowns

Backend: `https://hash-medusa.onrender.com`. Use the existing `/hash-store/config` bootstrap and HFG customer token exchange; no new user account or changes to hfg-user-onboard are required. The app team must implement the UI changes below in their app build.

## Categories

Hash Operations → Categories manages names, handles, display order and visibility. “Add starter shop categories” creates Accessories, Keyboards, Mouse, Monitors and Chairs if their handles do not already exist. Operators can add other categories (for example Mousepads or Headsets). Vendors select one or more active categories in Listings → Create/Edit listing. Listing edits still require Hash approval. Existing listings remain uncategorized until assigned; they continue to appear under All.

`GET /store/hash/categories` with `x-publishable-api-key: <key from config>` returns:

```json
{"categories":[{"id":"pcat_...","name":"Accessories","handle":"accessories","description":"","rank":0,"is_active":true,"is_internal":false,"parent_category_id":null}]}
```

Render the returned list in its given order, using IDs for requests and names for labels. “All” is a local UI choice and has no category ID. The backend does not include icon assets; map known handles to app icons and use a generic category icon for new handles. Do not hardcode the list of category names. Hidden/internal categories are not returned. The Hash UI currently manages a flat list; parent IDs from existing Medusa categories are informational, and filters match exact assignments (not descendants).

`GET /store/hash/products?category_id=pcat_...&offset=0&limit=20` filters approved listings before pagination. Omit `category_id` for All. `vendor_id` can be combined with it. An unknown or hidden category returns no matching products. Each product includes:

```json
{"product_id":"prod_...","categories":[{"id":"pcat_...","name":"Accessories","handle":"accessories"}]}
```

If the app uses Medusa's native product list for calculated cart-region pricing, use its existing `GET /store/products?category_id[]=pcat_...` filter and request `+categories` in `fields` as needed. Categories are native Medusa assignments, so both catalogs share them. Keep using the native calculated prices/payment/cart flow; category metadata is not a pricing or discount calculation.

Changing category resets product pagination. Show an empty-state message rather than falling back to all products. Hiding a category does not unpublish its products; those products remain visible under All and any other active assigned category.

## Country and state selectors

Public bootstrap endpoints (no login or publishable key required):

- `GET /hash-store/locations` → `{ "countries": [{ "code": "in", "name": "India" }, ...] }`
- `GET /hash-store/locations?country_code=in` → `{ "country_code": "in", "state_required": true, "address_value": "name", "states": [{ "code": "MH", "name": "Maharashtra" }, ...] }`

Country codes are lowercase ISO two-letter codes. State lists include union territories/provinces. Use the returned state `name` as the stored address value; `code` is a selection identifier only. State short codes are only unique within a country. The dataset is versioned with the backend and responses can be cached for 24 hours.

1. Limit delivery-country choices to the checkout region's configured countries; the geographic directory alone does not enable international delivery. Current Delhivery dispatch supports India only.
2. On country change, immediately clear the selected state and fetch the new list. Ignore stale responses if the user switches countries quickly.
3. Show a dropdown for state/province. Disable save while loading; on failure show Retry, do not permit arbitrary text or retain another country's state.
4. If `state_required` is false, hide the state field or show Not applicable and store an empty string.
5. For an existing address, match its state case-insensitively by name or short code. If there is no match, ask for a fresh selection rather than silently replacing it.

Medusa cart/customer address payload:

```json
{"country_code":"in","province":"Maharashtra","city":"Mumbai","postal_code":"400001","address_1":"Example street","first_name":"Customer","phone":"..."}
```

The existing HFG address model uses different keys (`State`, `Country`). Keep that service's existing contract; put the selected state name into `State` and translate the selected country to its expected representation. When copying an HFG address into Medusa checkout, explicitly map to `province` and lowercase `country_code`. No second login is needed.

Hash Partners uses the same directory for business addresses, fulfillment locations, delivery-address review and pickup-address review. Existing historical order addresses are not rewritten. Bank beneficiary address remains a full postal-address text block, not a separate state field.

## Partner/API authorization

- `GET /admin/hash` includes active public `categories` and category objects on each listing.
- `POST /admin/hash`, action `save_product`, accepts `category_ids: ["pcat_..."]` (max 20). An omitted property preserves categories on edits; `[]` explicitly clears them. Vendor ownership checks remain in force.
- `GET /admin/hash/categories`: vendors see selectable categories; Hash admins see all.
- `POST /admin/hash/categories`: Hash admins only. Body: `{ "id": "pcat_... (omit to create)", "name": "Accessories", "handle": "accessories", "description": "", "rank": 0, "is_active": true }`.

Never put admin credentials in the customer app. Category and geographic endpoints do not return private partner data.
