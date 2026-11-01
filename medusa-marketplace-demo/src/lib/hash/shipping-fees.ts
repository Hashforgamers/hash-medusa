import { fail } from './access'

// Called with the order advisory lock. Never rewrite amounts already sent to a bank.
export function shippingAllocation(net:number,fee:number,paid:number,firstTarget:number){
 const available=Math.max(0,net-fee-paid)
 return {available,recovery:Math.max(0,paid+fee-net),payment:Math.min(available,firstTarget)}
}
export async function applyShippingFee(c:any,orderId:string){
 const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1',[orderId])
 if(!o)return
 const {rows:[shipment]}=await c.query('SELECT fee_final FROM hash_shipment WHERE order_id=$1',[orderId])
 if(shipment&&!shipment.fee_final)return
 const vendorGateway=o.commercial_snapshot?.gateway_payer==='vendor'
 if(vendorGateway&&o.gateway_fee_paise==null)return
 const fees=Number(o.shipping_fee_paise)+(vendorGateway?Number(o.gateway_fee_paise):0)
 const firstTarget=Math.floor(Math.max(0,Number(o.net_paise)-fees)*o.settlement_plan.capture_bps/10000)
 const {rows:ss}=await c.query('SELECT * FROM hash_settlement WHERE order_id=$1 FOR UPDATE',[orderId])
 if(ss.some((s:any)=>s.status==='processing'))return // Invoice edits are separately blocked while a transfer is processing.
 const paid=ss.filter((s:any)=>s.status==='paid').reduce((n:number,s:any)=>n+Number(s.amount_paise),0)
 const allocation=shippingAllocation(Number(o.net_paise),fees,paid,firstTarget)
 let available=allocation.available
 for(const milestone of ['payment','completion']){
  const s=ss.find((s:any)=>s.milestone===milestone);if(!s||s.status==='paid')continue
  const target=milestone==='payment'?firstTarget:available
  const amount=Math.min(available,target);available-=amount
  await c.query('UPDATE hash_settlement SET amount_paise=$2 WHERE id=$1',[s.id,amount])
 }
 await c.query('UPDATE hash_order SET recovery_paise=$2 WHERE order_id=$1',[orderId,allocation.recovery])
}
export async function assertShippingPayable(c:any,orderId:string){
 const blocked=await c.query(`SELECT 1 FROM hash_order WHERE order_id=$1 AND (
  canceled_at IS NOT NULL OR reviewed_canceled OR (captured_paise>0 AND refunded_paise>=captured_paise)
  OR (cancellation_request IS NOT NULL AND cancellation_request->>'status' IS DISTINCT FROM 'closed')
 )`,[orderId])
 if(blocked.rowCount)fail('Vendor payout is blocked for this cancellation or full refund')
 if((await c.query("SELECT 1 FROM hash_order WHERE order_id=$1 AND commercial_snapshot->>'gateway_payer'='vendor' AND gateway_fee_paise IS NULL",[orderId])).rowCount)fail('Verified Razorpay charges are required before vendor-funded settlement')
 if((await c.query("SELECT 1 FROM hash_order o WHERE o.order_id=$1 AND ((o.delivery_kind='product' AND NOT EXISTS(SELECT 1 FROM hash_shipment hs WHERE hs.order_id=o.order_id AND hs.fee_final)) OR EXISTS(SELECT 1 FROM hash_shipment hs WHERE hs.order_id=o.order_id AND hs.fee_final=false AND hs.status<>'quoted'))",[orderId])).rowCount)fail('Reconcile the final Delhivery invoice charge before paying this order')
}
