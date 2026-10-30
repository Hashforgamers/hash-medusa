/** Transactional history. Imported rows are labelled opening snapshots, never invented past events. */
export async function installAccountJournal(pool:any){
 const c=await pool.connect()
 try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('hash-account-journal-v1',0))")
 await c.query(`CREATE TABLE IF NOT EXISTS hash_account_event(id bigserial PRIMARY KEY,order_id text NOT NULL,vendor_id text NOT NULL,event_type text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS hash_account_event_order ON hash_account_event(order_id,id);
 CREATE TABLE IF NOT EXISTS hash_account_migration(id text PRIMARY KEY);
 LOCK TABLE hash_order,hash_settlement IN SHARE ROW EXCLUSIVE MODE;
 CREATE OR REPLACE FUNCTION hash_account_order_state(o hash_order) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('currency',o.currency_code,'customer_paid_minor',o.captured_paise,'customer_refunded_minor',o.refunded_paise,'seller_before_courier_minor',o.net_paise,'courier_fee_minor',o.shipping_fee_paise,'platform_fee_minor',o.platform_fee_paise,'gateway_fee_minor',o.gateway_fee_paise,'hold_reason',o.hold_reason,'paid_at',o.paid_at,'completed_at',o.completed_at,'reviewed_refund_minor',o.reviewed_refund_paise,'reviewed_canceled',o.reviewed_canceled)
 $$;
 CREATE OR REPLACE FUNCTION hash_account_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE before_state jsonb;after_state jsonb;
 BEGIN
 after_state=hash_account_order_state(NEW);
 IF TG_OP='UPDATE' THEN before_state=hash_account_order_state(OLD);IF before_state=after_state THEN RETURN NEW;END IF;END IF;
 INSERT INTO hash_account_event(order_id,vendor_id,event_type,details) VALUES(NEW.order_id,NEW.vendor_id,CASE WHEN TG_OP='INSERT' THEN 'order_created' ELSE 'account_updated' END,jsonb_build_object('before',before_state,'after',after_state));RETURN NEW;
 END $$;
 CREATE OR REPLACE FUNCTION hash_account_settlement_event() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE before_state jsonb;after_state jsonb;
 BEGIN
 after_state=to_jsonb(NEW)-'vendor_id'-'order_id';
 IF TG_OP='UPDATE' THEN before_state=to_jsonb(OLD)-'vendor_id'-'order_id';IF before_state=after_state THEN RETURN NEW;END IF;END IF;
 INSERT INTO hash_account_event(order_id,vendor_id,event_type,details) VALUES(NEW.order_id,NEW.vendor_id,CASE WHEN TG_OP='INSERT' THEN 'payout_scheduled' ELSE 'payout_updated' END,jsonb_build_object('before',before_state,'after',after_state));RETURN NEW;
 END $$;
 DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM hash_account_migration WHERE id='opening-v1') THEN
 INSERT INTO hash_account_event(order_id,vendor_id,event_type,details) SELECT order_id,vendor_id,'opening_snapshot',jsonb_build_object('after',hash_account_order_state(o),'note','Imported existing balance; earlier journal events unavailable') FROM hash_order o;
 INSERT INTO hash_account_event(order_id,vendor_id,event_type,details) SELECT order_id,vendor_id,'opening_payout_snapshot',jsonb_build_object('after',to_jsonb(s)-'vendor_id'-'order_id','note','Imported existing payout; original paid_at is preserved') FROM hash_settlement s;
 INSERT INTO hash_account_migration VALUES('opening-v1');
 END IF;END $$;
 DROP TRIGGER IF EXISTS hash_account_order_event_trigger ON hash_order;
 CREATE TRIGGER hash_account_order_event_trigger AFTER INSERT OR UPDATE ON hash_order FOR EACH ROW EXECUTE FUNCTION hash_account_order_event();
 DROP TRIGGER IF EXISTS hash_account_settlement_event_trigger ON hash_settlement;
 CREATE TRIGGER hash_account_settlement_event_trigger AFTER INSERT OR UPDATE ON hash_settlement FOR EACH ROW EXECUTE FUNCTION hash_account_settlement_event();`)
 await c.query('COMMIT')
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
