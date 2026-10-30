import { db } from './db'
import { own,fail } from './access'
export function accountBreakdown(o:any,now=new Date()){
 const n=(k:string)=>Number(o[k]||0),paid=n('paid'),processing=n('processing'),gross=n('total_paise'),refund=n('refunded_paise')
 const recognized=!!o.paid_at&&o.payment_mode==='hash_collects'
 const retained=o.reviewed_canceled?0:Math.max(0,gross-Math.max(0,n('reviewed_refund_paise')))
 const platform=recognized?Math.round(n('platform_fee_paise')*retained/Math.max(1,gross)):0
 const commission=recognized?Math.max(0,retained-platform-n('net_paise')):0
 const entitlement=recognized?n('net_paise')-n('shipping_fee_paise'):0
 const balance=entitlement-paid,unpaid=Math.max(0,balance-processing)
 const held=!!o.hold_reason||!!o.payout_block_reason
 const due=held?0:Math.min(unpaid,n('due'))
 return {order_id:o.order_id,vendor_id:o.vendor_id,vendor_name:o.vendor_name,currency_code:o.currency_code,created_at:o.created_at,paid_at:o.paid_at,completed_at:o.completed_at,
 customer_paid_minor:n('captured_paise'),customer_refunded_minor:refund,product_minor:Math.max(0,gross-n('customer_shipping_paise')-n('platform_fee_paise')),
 customer_delivery_minor:n('customer_shipping_paise'),platform_fee_minor:platform,platform_fee_tax_minor:Math.round(platform*Number(o.commercial_snapshot?.platform_tax_bps||0)/(10000+Number(o.commercial_snapshot?.platform_tax_bps||0))),commission_minor:commission,courier_fee_minor:recognized?n('shipping_fee_paise'):0,courier_final:o.courier_final,
 gateway_fee_minor:o.gateway_fee_paise===null?null:n('gateway_fee_paise'),gateway_payer:'hash',
 seller_entitlement_minor:entitlement,paid_minor:paid,processing_minor:processing,balance_minor:balance,ready_minor:due,held_minor:held?unpaid:0,future_minor:held?0:Math.max(0,unpaid-due),recovery_minor:Math.max(0,-balance),
 hold_reason:o.hold_reason||o.payout_block_reason||null,refund_review_pending:refund>0&&refund!==Math.max(0,n('reviewed_refund_paise')),
 contribution_minor:recognized&&o.gateway_fee_paise!==null?commission+platform-n('gateway_fee_paise'):null}
}
export async function accounts(a:any,query:any){
 const vendor=a.superAdmin?(typeof query.vendor_id==='string'&&query.vendor_id||null):a.vendor_id
 if(vendor)own(a,vendor)
 const limit=Math.min(100,Math.max(1,Number(query.limit)||25)),offset=Math.max(0,Math.floor(Number(query.offset)||0))
 const from=query.from?new Date(String(query.from)):null,to=query.to?new Date(String(query.to)):null
 if((from&&!Number.isFinite(+from))||(to&&!Number.isFinite(+to))||(from&&to&&from>=to))fail('Use a valid date range')
 const {rows}=await db().query(`SELECT o.order_id,o.vendor_id,o.currency_code,o.created_at,o.paid_at,o.completed_at,o.total_paise,o.net_paise,o.platform_fee_paise,o.commercial_snapshot,o.gateway_fee_paise,o.captured_paise,o.refunded_paise,o.reviewed_refund_paise,o.reviewed_canceled,o.payment_mode,o.shipping_fee_paise,o.customer_shipping_paise,o.hold_reason,v.name AS vendor_name,
 CASE WHEN hs.order_id IS NULL THEN true ELSE hs.fee_final END AS courier_final,
 CASE WHEN hs.order_id IS NOT NULL AND hs.status<>'quoted' AND NOT hs.fee_final THEN 'Awaiting final courier invoice' WHEN v.status<>'active' THEN 'Partner suspended' WHEN NOT(v.bank_details ? 'account_number') THEN 'Bank account required' WHEN v.bank_verified_at IS NULL THEN 'Bank verification required' WHEN v.bank_details->>'currency_code'<>o.currency_code THEN 'Bank currency mismatch' ELSE NULL END AS payout_block_reason,
 COALESCE(s.paid,0) AS paid,COALESCE(s.processing,0) AS processing,COALESCE(s.due,0) AS due
 FROM hash_order o JOIN hash_vendor v ON v.id=o.vendor_id LEFT JOIN hash_shipment hs ON hs.order_id=o.order_id
 LEFT JOIN LATERAL (SELECT sum(amount_paise) FILTER(WHERE status='paid') AS paid,sum(amount_paise) FILTER(WHERE status='processing') AS processing,sum(amount_paise) FILTER(WHERE status IN ('scheduled','failed') AND due_at<=now()) AS due FROM hash_settlement WHERE order_id=o.order_id) s ON true
 WHERE ($1::text IS NULL OR o.vendor_id=$1) AND ($2::timestamptz IS NULL OR o.created_at>=$2) AND ($3::timestamptz IS NULL OR o.created_at<$3) ORDER BY o.created_at DESC,o.order_id`,[vendor,from,to])
 const all=rows.map(o=>accountBreakdown(o)),totals:any={}
 for(const o of all){const t=totals[o.currency_code]||={currency_code:o.currency_code,orders:0,gateway_pending_orders:0};t.orders++;for(const k of ['customer_paid_minor','customer_refunded_minor','platform_fee_minor','platform_fee_tax_minor','commission_minor','courier_fee_minor','seller_entitlement_minor','paid_minor','processing_minor','balance_minor','ready_minor','held_minor','future_minor','recovery_minor'])t[k]=(t[k]||0)+o[k];if(o.gateway_fee_minor===null)t.gateway_pending_orders++;else t.gateway_fee_minor=(t.gateway_fee_minor||0)+o.gateway_fee_minor}
 let detail:any=null
 if(query.order_id){const o=all.find(o=>o.order_id===query.order_id);if(!o)fail('Order not found');const {rows:settlements}=await db().query('SELECT id,milestone,amount_paise,due_at,status,provider,reference,paid_at,failure_reason FROM hash_settlement WHERE order_id=$1 ORDER BY due_at,id',[o.order_id]);const {rows:history}=await db().query(`SELECT id,event_type,details,created_at FROM hash_account_event WHERE order_id=$1 ORDER BY id`,[o.order_id]);const {rows:adjustments}=await db().query(`SELECT action,created_at,detail->>'note' AS note,detail->>'reference' AS reference,detail->>'amount_paise' AS amount_minor FROM hash_audit WHERE (entity_id=$1 OR entity_id IN (SELECT id FROM hash_settlement WHERE order_id=$1)) AND action IN ('manual_payout_recorded','shipping_invoice_reconciled','refund_settlement_adjusted','provider_payout_manually_resolved','payout_failed') ORDER BY id`,[o.order_id]);detail={order:o,settlements,history,adjustments}}
 return {totals:Object.values(totals),orders:all.slice(offset,offset+limit),count:all.length,offset,limit,detail,date_basis:'Order creation date; balances include subsequent activity for those orders. Current amounts, not a historical balance as of the end date.'}
}
