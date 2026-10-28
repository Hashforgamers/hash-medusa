import { Pool, PoolClient } from "pg"
let pool: Pool
export function db(): Pool {
  return pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 8 })
}
export async function transaction<T>(key: string, work: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect()
  try {
    await c.query("BEGIN")
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key])
    const result = await work(c)
    await c.query("COMMIT")
    return result
  } catch (e) { await c.query("ROLLBACK"); throw e } finally { c.release() }
}
export async function audit(c: any, actor: string, action: string, entity: string, detail: any = {}) {
  await c.query("INSERT INTO hash_audit(actor, action, entity_id, detail) VALUES($1,$2,$3,$4)", [actor, action, entity, JSON.stringify(detail)])
}
export async function migrate() {
  const {rows:[existing]}=await db().query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='hash_order' AND column_name='settlement_plan') AS ready")
  await db().query(`
  CREATE TABLE IF NOT EXISTS hash_vendor (
    id text PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    commission_bps integer NOT NULL DEFAULT 0 CHECK(commission_bps BETWEEN 0 AND 10000),
    payment_mode text NOT NULL DEFAULT 'hash_collects' CHECK(payment_mode IN ('hash_collects','vendor_direct')),
    payout_details text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS business_details jsonb NOT NULL DEFAULT '{}';
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS bank_details jsonb NOT NULL DEFAULT '{}';
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS bank_revision integer NOT NULL DEFAULT 0;
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS bank_verified_at timestamptz;
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS bank_verified_by text;
  CREATE TABLE IF NOT EXISTS hash_settlement_plan (
    id text PRIMARY KEY, revision integer NOT NULL DEFAULT 1, definition jsonb NOT NULL,
    active boolean NOT NULL DEFAULT true, is_default boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO hash_settlement_plan(id,definition,is_default) VALUES('default','{"name":"Standard 50/50","capture_bps":5000,"capture_delay":1,"completion_delay":1,"day_type":"business","timezone":"Asia/Kolkata","weekend":[0,6],"holidays":[]}',true) ON CONFLICT(id) DO NOTHING;
  CREATE UNIQUE INDEX IF NOT EXISTS hash_one_default_plan ON hash_settlement_plan(is_default) WHERE is_default;
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS settlement_plan_id text REFERENCES hash_settlement_plan(id);
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS payout_provider_id text NOT NULL DEFAULT 'manual';
  CREATE TABLE IF NOT EXISTS hash_payout_provider (
    id text PRIMARY KEY, name text NOT NULL, revision integer NOT NULL DEFAULT 1, config jsonb NOT NULL,
    secret_encrypted text, active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_member (
    user_id text PRIMARY KEY, vendor_id text NOT NULL REFERENCES hash_vendor(id),
    role text NOT NULL CHECK(role IN ('owner','staff'))
  );
  CREATE TABLE IF NOT EXISTS hash_listing (
    product_id text PRIMARY KEY, vendor_id text NOT NULL REFERENCES hash_vendor(id),
    kind text NOT NULL CHECK(kind IN ('product','service')),
    approval text NOT NULL DEFAULT 'pending' CHECK(approval IN ('pending','approved','rejected')),
    review_note text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_order (
    order_id text PRIMARY KEY, vendor_id text NOT NULL REFERENCES hash_vendor(id), customer_id text,
    total_paise bigint NOT NULL CHECK(total_paise >= 0), net_paise bigint NOT NULL CHECK(net_paise >= 0),
    commission_bps integer NOT NULL, payment_mode text NOT NULL,
    captured_paise bigint NOT NULL DEFAULT 0, refunded_paise bigint NOT NULL DEFAULT 0,
    paid_at timestamptz, completed_at timestamptz, hold_reason text,
    otp_hash text, otp_nonce text, otp_expires_at timestamptz, otp_issued_at timestamptz,
    otp_attempts integer NOT NULL DEFAULT 0, otp_locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'inr';
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS reviewed_total_paise bigint;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS reviewed_refund_paise bigint NOT NULL DEFAULT -1;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS reviewed_canceled boolean NOT NULL DEFAULT false;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS recovery_paise bigint NOT NULL DEFAULT 0;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS settlement_plan jsonb NOT NULL DEFAULT '{"id":"legacy","revision":1,"name":"Legacy 50/50","capture_bps":5000,"capture_delay":1,"completion_delay":1,"day_type":"business","timezone":"Asia/Kolkata","weekend":[0,6],"holidays":[]}';
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'placed';
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS delivery_kind text NOT NULL DEFAULT 'product';
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS delivery_revision integer NOT NULL DEFAULT 0;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS delivery_details jsonb NOT NULL DEFAULT '{}';
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS order_placed_at timestamptz;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS shipping_fee_paise bigint NOT NULL DEFAULT 0 CHECK(shipping_fee_paise >= 0);
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS shipping_payer text NOT NULL DEFAULT 'seller' CHECK(shipping_payer IN ('seller','customer'));
  ALTER TABLE hash_vendor ADD COLUMN IF NOT EXISTS shipping_policy_revision integer NOT NULL DEFAULT 1;
  ALTER TABLE hash_listing ADD COLUMN IF NOT EXISTS shipping_package jsonb;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS shipping_payer text NOT NULL DEFAULT 'seller';
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS customer_shipping_paise bigint NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS hash_cart_shipping_quote (
    cart_id text PRIMARY KEY, id text NOT NULL, vendor_id text NOT NULL, payer text NOT NULL,
    fingerprint text NOT NULL, amount_paise bigint NOT NULL, policy_revision integer NOT NULL,
    expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_checkout_shipping_receipt (
    id text PRIMARY KEY, cart_id text NOT NULL, fingerprint text NOT NULL, amount_paise bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_shipping_config (
    id text PRIMARY KEY, secret_encrypted text NOT NULL, active boolean NOT NULL DEFAULT false,
    verified_at timestamptz, revision integer NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS hash_shipping_pickup (
    vendor_id text PRIMARY KEY REFERENCES hash_vendor(id), name text NOT NULL, pincode text NOT NULL,
    revision integer NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS hash_shipment (
    order_id text PRIMARY KEY REFERENCES hash_order(order_id), vendor_id text NOT NULL REFERENCES hash_vendor(id),
    status text NOT NULL DEFAULT 'quoted', waybill text UNIQUE, parcel jsonb NOT NULL,
    pickup jsonb NOT NULL, quote_paise bigint NOT NULL, quoted_at timestamptz NOT NULL DEFAULT now(),
    fee_paise bigint NOT NULL DEFAULT 0 CHECK(fee_paise >= 0), fee_final boolean NOT NULL DEFAULT false,
    invoice_reference text, revision integer NOT NULL DEFAULT 1, carrier_status text,
    carrier_at timestamptz, synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_dispatch_location (
    name text PRIMARY KEY,vendor_id text NOT NULL REFERENCES hash_vendor(id),address jsonb NOT NULL,
    status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_pickup_request (
    id bigserial PRIMARY KEY,location_name text NOT NULL,pickup_date text NOT NULL,
    status text NOT NULL,carrier_id text,created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(location_name,pickup_date)
  );
  ALTER TABLE hash_shipment ADD COLUMN IF NOT EXISTS pickup_request_id bigint REFERENCES hash_pickup_request(id);
  CREATE TABLE IF NOT EXISTS hash_delivery_event (
    id bigserial PRIMARY KEY,order_id text NOT NULL REFERENCES hash_order(order_id),status text NOT NULL,
    note text NOT NULL DEFAULT '',details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS hash_delivery_event_order ON hash_delivery_event(order_id,id);
  CREATE TABLE IF NOT EXISTS hash_settlement (
    id text PRIMARY KEY, order_id text NOT NULL REFERENCES hash_order(order_id),
    vendor_id text NOT NULL REFERENCES hash_vendor(id), milestone text NOT NULL CHECK(milestone IN ('payment','completion')),
    amount_paise bigint NOT NULL CHECK(amount_paise >= 0), due_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','processing','paid','failed')),
    provider text NOT NULL DEFAULT 'manual', reference text, paid_at timestamptz, failure_reason text,
    UNIQUE(order_id,milestone)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS hash_payout_reference ON hash_settlement(provider, reference) WHERE reference IS NOT NULL;
  CREATE TABLE IF NOT EXISTS hash_customer_plan (
    id text PRIMARY KEY, revision integer NOT NULL DEFAULT 1, definition jsonb NOT NULL,
    active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE hash_customer_plan ADD COLUMN IF NOT EXISTS razorpay_plan_id text;
  ALTER TABLE hash_customer_plan ADD COLUMN IF NOT EXISTS razorpay_mode text;
  ALTER TABLE hash_customer_plan ADD COLUMN IF NOT EXISTS razorpay_key_id text;
  CREATE TABLE IF NOT EXISTS hash_razorpay_config (
    mode text PRIMARY KEY CHECK(mode IN ('test','live')), key_id text NOT NULL, secret_encrypted text NOT NULL,
    webhook_encrypted text NOT NULL, active boolean NOT NULL DEFAULT false, verified_at timestamptz,
    webhook_seen_at timestamptz, revision integer NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS hash_subscription (
    id text PRIMARY KEY, customer_id text NOT NULL, plan_id text NOT NULL REFERENCES hash_customer_plan(id),
    plan_revision integer NOT NULL, definition jsonb NOT NULL, mode text NOT NULL, key_id text NOT NULL,
    remote_id text UNIQUE, status text NOT NULL DEFAULT 'creating', checkout_url text,
    request_key text NOT NULL, current_start bigint,current_end bigint,paid_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(customer_id,request_key)
  );
  CREATE TABLE IF NOT EXISTS hash_billing_payment (
    payment_id text PRIMARY KEY, subscription_id text NOT NULL REFERENCES hash_subscription(id),
    amount_minor bigint NOT NULL,currency text NOT NULL,status text NOT NULL,refunded_minor bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_billing_event (
    id text PRIMARY KEY,mode text NOT NULL,event text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS hash_payout_attempt (
    id text PRIMARY KEY, settlement_id text NOT NULL REFERENCES hash_settlement(id), provider_id text NOT NULL,
    provider_revision integer NOT NULL, status text NOT NULL CHECK(status IN ('processing','paid','not_sent')),
    reference text, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
  );
  CREATE UNIQUE INDEX IF NOT EXISTS hash_one_open_payout ON hash_payout_attempt(settlement_id) WHERE status='processing';
  CREATE TABLE IF NOT EXISTS hash_audit (
    id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity_id text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS hash_listing_vendor ON hash_listing(vendor_id);
  CREATE INDEX IF NOT EXISTS hash_order_vendor ON hash_order(vendor_id);
  CREATE INDEX IF NOT EXISTS hash_settlement_due ON hash_settlement(status,due_at);
  `)
  if(!existing.ready){
    const holidays=(process.env.HASH_SETTLEMENT_HOLIDAYS||'').split(',').map(s=>s.trim()).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s))
    await db().query("UPDATE hash_order SET settlement_plan=jsonb_set(settlement_plan,'{holidays}',$1::jsonb) WHERE settlement_plan->>'id'='legacy'",[JSON.stringify(holidays)])
    await db().query("UPDATE hash_settlement_plan SET definition=jsonb_set(definition,'{holidays}',$1::jsonb) WHERE id='default' AND revision=1",[JSON.stringify(holidays)])
  }
}
