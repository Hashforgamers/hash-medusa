import { z } from 'zod'
import { db,transaction,audit } from './db'
import { fail,own,requireHash } from './access'
import { delhiveryConfig,delhiveryRequest,syncShipment } from './delhivery'
export const cancellationReason=z.string().trim().min(5).max(500)
const active=(o:any)=>o.cancellation_request&&o.cancellation_request.status!=='closed'
export async function requestCancellation(orderId:string,reason:string,identity:{customerId?:string,actor?:any}){
 reason=cancellationReason.parse(reason)
 return transaction(`order:${orderId}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[orderId]);if(!o)fail('Order not found')
  if(identity.customerId){if(o.customer_id!==identity.customerId)fail('Order not found')}else own(identity.actor,o.vendor_id)
  if(active(o))return o.cancellation_request
  if(o.completed_at||o.canceled_at||o.reviewed_canceled)fail('This order is already completed or canceled; contact support for a return')
  const request={status:'requested',reason,requested_at:new Date().toISOString(),source:identity.customerId?'customer':'partner_recorded'}
  await c.query('UPDATE hash_order SET cancellation_request=$2,hold_reason=$3,delivery_revision=delivery_revision+1 WHERE order_id=$1',[orderId,request,'Customer cancellation requires review'])
  await c.query('INSERT INTO hash_delivery_event(order_id,status,note) VALUES($1,$2,$3)',[orderId,'cancellation_requested','Customer cancellation requested; awaiting review'])
  await audit(c,identity.customerId||identity.actor.id,'customer_cancellation_requested',orderId,{source:request.source})
  return request
 })
}
export async function cancelCourier(a:any,orderId:string){
 const {rows:[o]}=await db().query('SELECT * FROM hash_order WHERE order_id=$1',[orderId]);if(!o)fail('Order not found');own(a,o.vendor_id)
 if(o.cancellation_request?.status!=='requested')fail('A pending customer cancellation request is required; existing submissions must be reviewed')
 const {rows:[shipment]}=await db().query('SELECT * FROM hash_shipment WHERE order_id=$1',[orderId])
 if(shipment?.status==='booking')fail('Resolve the pending shipment booking before canceling')
 let cfg:any
 if(shipment?.waybill){cfg=await delhiveryConfig();await syncShipment(orderId,cfg.token,a.id,true)}
 const claim=await transaction(`order:${orderId}`,async c=>{
  const {rows:[current]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[orderId]);own(a,current.vendor_id)
  if(current.cancellation_request?.status!=='requested')fail('Cancellation already submitted; refresh')
  if(current.completed_at)fail('Delivery is completed; contact Hash for returns')
  const {rows:[s]}=await c.query('SELECT * FROM hash_shipment WHERE order_id=$1 FOR UPDATE',[orderId])
  if(s?.status==='booking')fail('Resolve the pending booking first')
  if(s?.waybill&&!['Manifested','In Transit','Pending'].includes(s.carrier_status))fail('Delhivery does not allow cancellation at this carrier stage. Contact Hash Operations for returns.')
  const status=s?.waybill?'submitting':'not_booked'
  await c.query("UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb WHERE order_id=$1",[orderId,{status,submitted_at:new Date().toISOString()}])
  await audit(c,a.id,'courier_cancellation_requested',orderId,{waybill:s?.waybill||null})
  return s?.waybill?{waybill:s.waybill}:null
 })
 if(!claim)return {message:'No courier shipment was booked. Dispatch is stopped; Hash Operations must review the order and refund.'}
 try{
  const response=await delhiveryRequest(cfg.token,'/api/p/edit',{waybill:claim.waybill,cancellation:'true'},true)
  if(response.status!==true)throw Error('Carrier cancellation not confirmed')
  await finishCancellation(orderId,a.id,'courier_requested','Delhivery accepted the cancellation request. A parcel already in transit may return to the seller. Refund review is separate.')
  return {message:'Delhivery accepted the cancellation request. Track return progress; Hash Operations must review the refund.'}
 }catch{
  await finishCancellation(orderId,a.id,'review','Courier cancellation confirmation is uncertain. Hash Operations is checking with Delhivery.')
  return {message:'Cancellation confirmation is uncertain. Do not resubmit; Hash Operations must verify it in Delhivery One.'}
 }
}
async function finishCancellation(id:string,actor:string,status:string,note:string){await transaction(`order:${id}`,async c=>{await c.query('UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb WHERE order_id=$1',[id,{status,updated_at:new Date().toISOString()}]);await c.query('INSERT INTO hash_delivery_event(order_id,status,note) VALUES($1,$2,$3)',[id,status==='courier_requested'?'courier_cancellation_requested':'cancellation_review',note]);await audit(c,actor,'courier_cancellation_result',id,{status})})}
export async function resolveCancellation(a:any,b:any){
 requireHash(a)
 return transaction(`order:${b.order_id}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id]);const r=o?.cancellation_request
  if(!r||!['submitting','review'].includes(r.status)||Date.now()-Date.parse(r.submitted_at)<120000)fail('Only uncertain submissions older than two minutes can be resolved')
  const status=b.accepted?'courier_requested':'requested'
  await c.query('UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb WHERE order_id=$1',[b.order_id,{status,reviewed_at:new Date().toISOString()}])
  await audit(c,a.id,'courier_cancellation_verified',b.order_id,{accepted:b.accepted,note:b.note})
  return {message:b.accepted?'Carrier acceptance recorded; refund review remains pending.':'Confirmed not accepted by carrier. Cancellation may be retried.'}
 })
}
