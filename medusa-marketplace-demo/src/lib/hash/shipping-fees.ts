import { fail } from './access'

// Called with the order advisory lock. Never rewrite amounts already sent to a bank.
export function shippingAllocation(net:number,fee:number,paid:number,firstTarget:number){
 const available=Math.max(0,net-fee-paid)
 return {available,recovery:Math.max(0,paid+fee-net),payment:Math.min(available,firstTarget)}
}
export async function applyShippingFee(c:any,orderId:string){
 const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1',[orderId])
 if(!o || !(await c.query('SELECT 1 FROM hash_shipment WHERE order_id=$1 AND fee_final',[orderId])).rowCount)return
 const {rows:ss}=await c.query('SELECT * FROM hash_settlement WHERE order_id=$1 FOR UPDATE',[orderId])
 if(ss.some((s:any)=>s.status==='processing'))return // Invoice edits are separately blocked while a transfer is processing.
 const paid=ss.filter((s:any)=>s.status==='paid').reduce((n:number,s:any)=>n+Number(s.amount_paise),0)
 const allocation=shippingAllocation(Number(o.net_paise),Number(o.shipping_fee_paise),paid,Math.floor(Number(o.net_paise)*o.settlement_plan.capture_bps/10000))
 let available=allocation.available
 for(const milestone of ['payment','completion']){
  const s=ss.find((s:any)=>s.milestone===milestone);if(!s||s.status==='paid')continue
  const target=milestone==='payment'?Math.floor(Number(o.net_paise)*o.settlement_plan.capture_bps/10000):available
  const amount=Math.min(available,target);available-=amount
  await c.query('UPDATE hash_settlement SET amount_paise=$2 WHERE id=$1',[s.id,amount])
 }
 await c.query('UPDATE hash_order SET recovery_paise=$2 WHERE order_id=$1',[orderId,allocation.recovery])
}
export async function assertShippingPayable(c:any,orderId:string){
 if((await c.query("SELECT 1 FROM hash_shipment WHERE order_id=$1 AND fee_final=false AND status<>'quoted'",[orderId])).rowCount)fail('Reconcile the final Delhivery invoice charge before paying this order')
}
