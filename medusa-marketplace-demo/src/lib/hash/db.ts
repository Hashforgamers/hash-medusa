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
  await db().query(`
  CREATE TABLE IF NOT EXISTS hash_vendor (
    id text PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    commission_bps integer NOT NULL DEFAULT 0 CHECK(commission_bps BETWEEN 0 AND 10000),
    payment_mode text NOT NULL DEFAULT 'hash_collects' CHECK(payment_mode IN ('hash_collects','vendor_direct')),
    payout_details text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
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
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS reviewed_total_paise bigint;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS reviewed_refund_paise bigint NOT NULL DEFAULT -1;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS reviewed_canceled boolean NOT NULL DEFAULT false;
  ALTER TABLE hash_order ADD COLUMN IF NOT EXISTS recovery_paise bigint NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS hash_settlement (
    id text PRIMARY KEY, order_id text NOT NULL REFERENCES hash_order(order_id),
    vendor_id text NOT NULL REFERENCES hash_vendor(id), milestone text NOT NULL CHECK(milestone IN ('payment','completion')),
    amount_paise bigint NOT NULL CHECK(amount_paise >= 0), due_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','processing','paid','failed')),
    provider text NOT NULL DEFAULT 'manual', reference text, paid_at timestamptz, failure_reason text,
    UNIQUE(order_id,milestone)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS hash_payout_reference ON hash_settlement(provider, reference) WHERE reference IS NOT NULL;
  CREATE TABLE IF NOT EXISTS hash_audit (
    id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity_id text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS hash_listing_vendor ON hash_listing(vendor_id);
  CREATE INDEX IF NOT EXISTS hash_order_vendor ON hash_order(vendor_id);
  CREATE INDEX IF NOT EXISTS hash_settlement_due ON hash_settlement(status,due_at);
  `)
}
