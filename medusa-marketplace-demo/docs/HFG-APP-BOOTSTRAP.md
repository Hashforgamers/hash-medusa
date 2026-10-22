# Hash Store: app team handoff

Release contract for the Hash Store bootstrap API. No change is required in hfg-user-onboard. Verify `/hash-store/config` responds with 200 in the target environment before enabling store access.

## 1. Fetch configuration when opening Hash Store

The app needs only the Medusa backend base URL in its environment configuration:

- Local: `http://localhost:9000` (on a physical phone use a reachable development host).
- Hosted: `https://hash-medusa.onrender.com`.

**GET `/hash-store/config`**

No login, Authorization header, publishable key, cookies, or request body is required. Browser clients can call it cross-origin. Use a simple GET without custom headers. This endpoint intentionally sits outside `/store`, whose requests already require a key.

```bash
curl http://localhost:9000/hash-store/config
```

Response `200` (illustrative values):

```json
{
  "version": 1,
  "publishable_api_key": "pk_example",
  "region_id": "reg_example",
  "sales_channel_id": "sc_example",
  "currency_code": "inr",
  "country_code": "in"
}
```

These are public storefront values, safe for the app to read. They do not grant admin access or access to another customer's orders. Never send admin credentials to this endpoint or bundle them in the app.

The backend selects the active **HFG Frontend** publishable key linked to the enabled **Hash Marketplace** sales channel and the INR region covering India. Missing or ambiguous configuration returns `503`:

```json
{"code":"store_configuration_unavailable","message":"Store configuration is unavailable. Please try again later."}
```

On network failure or 503, show a retry state; do not proceed with empty or example values. The free server may take time to wake up. Responses use `Cache-Control: no-store`; keep the result in app memory for the current store session and fetch again on the next store entry. After key rotation, refetch once on a key-related rejection. Never blindly replay checkout, payment, or other writes.

## 2. Use the returned values for store requests

Every `/store/*` request needs `x-publishable-api-key: <publishable_api_key>`.
Use `region_id` for INR pricing and `region_id` plus `sales_channel_id` when creating the cart. JSON writes need `Content-Type: application/json`. Customer-specific requests also need the Medusa customer bearer token.

TypeScript example (web or React Native):

```ts
const MEDUSA_BASE_URL = 'http://localhost:9000'; // environment config

export async function loadStoreConfig() {
  const response = await fetch(`${MEDUSA_BASE_URL}/hash-store/config`, {
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Store unavailable. Please retry.');
  const config = await response.json();
  if (config.version !== 1 || !config.publishable_api_key?.startsWith('pk_') ||
      !config.region_id || !config.sales_channel_id) {
    throw new Error('Invalid store configuration');
  }
  return config;
}

const config = await loadStoreConfig();
const response = await fetch(
  `${MEDUSA_BASE_URL}/store/products?region_id=${encodeURIComponent(config.region_id)}`,
  { headers: { 'x-publishable-api-key': config.publishable_api_key } },
);
if (!response.ok) throw new Error('Could not load products');
const { products } = await response.json();
```

Browser storefront requests still use the backend's configured `STORE_CORS` and `AUTH_CORS` allowed origins; the public config endpoint does not change those permissions.

## 3. Reuse the existing HFG login

1. Obtain the current HFG app bearer token from the existing login flow.
2. `POST /auth/customer/hfg` with JSON `{ "token": "<HFG_APP_TOKEN>" }` returns a Medusa token. Use the HFG app token accepted by hfg-user-onboard `/api/users`, not a Firebase ID token or user ID.
3. First use only: if the returned Medusa token has no `actor_id`, create the commerce profile with `POST /store/customers`, using the Medusa bearer token and fetched publishable key. Then repeat step 2 to get the linked customer token. JWT decoding here chooses the registration flow only; the server verifies authentication.
4. Use the Medusa customer token for customer/cart/order APIs; no second password is required. Clear store credentials on HFG logout.

HFG remains the identity source. Medusa stores commerce profiles, carts and orders. The public publishable key is not a customer login token.

## 4. Complete integration reference

Share these files with the app team together:

- `docs/HFG-APP-BOOTSTRAP.md` — this startup contract.
- `docs/HFG-STORE-API.md` — catalog, identity, cart, shipping, checkout, payment, order and OTP contracts.
- `docs/HFG-STORE.postman_collection.json` — runnable requests; set the base URL and copy configuration values from the bootstrap response.

Only one vendor per cart; INR/India remains the default. The local Operations Settings change adds a `markets` array and public `store` details to this response; see [Hash Operations](HASH-OPERATIONS.md). Use the chosen region ID for market-specific pricing and checkout; there is no automatic currency conversion. Real-money checkout requires a payment provider integration; the current demo payment provider does not collect real money.
