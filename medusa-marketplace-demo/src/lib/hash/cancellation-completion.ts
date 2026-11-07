import { Modules } from '@medusajs/framework/utils'
import { db,transaction,audit } from './db'
import { fail,requireHash } from './access'
import { reconcileOrder,reviewAdjustment } from './settlements'

export async function completeCancellation(container:any,a:any,b:any){
 requireHash(a)
 await reconcileOrder(container,b.order_id)
 await transaction(`order:${b.order_id}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id])
  const r=o?.cancellation_request
  if(!r)fail('No cancellation request exists for this order')
  if(r.completion?.status==='complete')return
  if(r.completion?.mode==='manual'&&r.completion?.status==='processing'&&Date.now()-Date.parse(r.completion.updated_at)<600000)fail('Cancellation is processing. Refresh to see its saved progress.')
  if(!['courier_requested','not_booked','closed'].includes(r.status))fail('Resolve the courier cancellation first')
  if(o.completed_at)fail('Delivery was completed. Review this as a return instead.')
  if((await c.query("SELECT 1 FROM hash_settlement WHERE order_id=$1 AND status='processing'",[b.order_id])).rowCount)fail('Resolve the vendor transfer in progress before canceling')
  const completion={...r.completion,mode:'manual',status:'queued',approved_by:r.completion?.approved_by||a.id,approved_at:r.completion?.approved_at||new Date().toISOString(),note:b.note,updated_at:new Date().toISOString(),error:null}
  await c.query("UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb,hold_reason='Cancellation approved; manual refund handling' WHERE order_id=$1",[b.order_id,{completion}])
  await audit(c,a.id,'cancellation_completion_approved',b.order_id,{note:b.note,mode:'manual'})
 })
 await processCancellation(container,b.order_id)
 return {message:'Cancellation progress saved. Hash handles any customer refund manually.'}
}

export async function processCancellation(container:any,orderId:string){
 const completion=await transaction(`order:${orderId}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[orderId])
  const state=o?.cancellation_request?.completion
  if(!state||state.status==='complete'||(state.mode==='manual'&&state.status==='needs_attention'))return null
  if(state.mode==='manual'&&state.status==='processing'&&Date.now()-Date.parse(state.updated_at)<600000)return null
  if(o.completed_at)fail('Delivered orders require a return review')
  const next={...state,mode:'manual',status:'processing',updated_at:new Date().toISOString(),error:null}
  await c.query("UPDATE hash_order SET cancellation_request=jsonb_set(cancellation_request,'{completion}',$2::jsonb) WHERE order_id=$1",[orderId,next])
  return next
 })
 if(!completion)return
 try{
  const {data:[order]}=await container.resolve('query').graph({entity:'order',fields:['id','status','items.id','fulfillments.canceled_at'],filters:{id:orderId}})
  if(!order)fail('Order not found')
  if(order.fulfillments?.some(f=>!f.canceled_at))fail('Cancel the active Medusa fulfillment first')
  // The standard cancellation workflow refunds captured payments. For manual
  // handling, cancel through the order module and release its inventory holds.
  if(order.status!=='canceled')await container.resolve(Modules.ORDER).cancel(orderId)
  await container.resolve(Modules.INVENTORY).deleteReservationItemsByLineItem((order.items||[]).map(i=>i.id))
  await reconcileOrder(container,orderId)
  await reviewAdjustment(container,{id:completion.approved_by},orderId,completion.note)
  await transaction(`order:${orderId}`,async c=>{
   const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[orderId])
   if(!o.canceled_at)throw Error('Order cancellation reconciliation is pending')
   const {rows:previousRefunds}=await c.query('SELECT refund_id,status FROM hash_cancellation_refund WHERE order_id=$1 AND refund_id IS NOT NULL',[orderId])
   const completed_at=new Date().toISOString()
   const refund={status:Number(o.refunded_paise)>=Number(o.captured_paise)?'settled':previousRefunds.length?'review_required':'manual_pending',provider_references:previousRefunds.map(r=>r.refund_id)}
   await c.query("UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb,delivery_status='canceled',delivery_revision=delivery_revision+1 WHERE order_id=$1",[orderId,{status:'closed',completion:{...completion,status:'complete',updated_at:completed_at,completed_at,error:null},refund}])
   await c.query('INSERT INTO hash_delivery_event(order_id,status,note) VALUES($1,$2,$3)',[orderId,'canceled','Order canceled. Hash handles any remaining customer refund manually.'])
   await audit(c,completion.approved_by,'cancellation_completed',orderId,{refund_status:refund.status,mode:'manual'})
  })
 }catch(error){
  await transaction(`order:${orderId}`,async c=>{
   await c.query("UPDATE hash_order SET cancellation_request=jsonb_set(cancellation_request,'{completion}',$2::jsonb) WHERE order_id=$1",[orderId,{...completion,status:'needs_attention',updated_at:new Date().toISOString(),error:String(error.message||'Cancellation requires review').slice(0,1000)}])
   await audit(c,completion.approved_by,'cancellation_completion_pending',orderId,{mode:'manual'})
  })
 }
}

export async function recordManualRefund(container:any,a:any,b:any){
 requireHash(a)
 await reconcileOrder(container,b.order_id)
 await transaction(`order:${b.order_id}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id])
  if(!o?.canceled_at)fail('Cancel the order before recording its manual refund')
  if(o.cancellation_request?.manual_refund){
   if(o.cancellation_request.manual_refund.reference===b.reference)return
   fail('A manual refund has already been recorded for this order')
  }
  const outstanding=Math.max(0,Number(o.captured_paise)-Number(o.refunded_paise))
  if(!outstanding)fail('There is no remaining captured payment to refund')
  if(b.amount_minor!==outstanding)fail('The remaining amount changed. Refresh before recording the refund.')
  const manual_refund={reference:b.reference,amount_minor:outstanding,total_refunded_minor:Number(o.captured_paise),recorded_by:a.id,recorded_at:new Date().toISOString()}
  await c.query("UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb,refunded_paise=captured_paise WHERE order_id=$1",[b.order_id,{manual_refund,refund:{status:'manual_recorded'}}])
  await audit(c,a.id,'manual_customer_refund_recorded',b.order_id,manual_refund)
 })
 await reviewAdjustment(container,a,b.order_id,'Manual customer refund recorded: '+b.reference)
 return {message:'Manual refund recorded. No payment was initiated by this action.'}
}

export async function processApprovedCancellations(container:any){
 // Include approvals stuck in the previous automatic-refund flow. Their saved
 // cancellation approval remains valid; recovery performs no payment API calls.
 const {rows}=await db().query("SELECT order_id FROM hash_order WHERE cancellation_request->'completion'->>'status' IN ('queued','refund_pending','processing','needs_attention') AND (cancellation_request->'completion'->>'mode' IS DISTINCT FROM 'manual' OR cancellation_request->'completion'->>'status'<>'needs_attention') ORDER BY cancellation_request->'completion'->>'updated_at' ASC NULLS FIRST LIMIT 25")
 for(const row of rows){try{await processCancellation(container,row.order_id)}catch(e){container.resolve('logger').error('Cancellation recovery failed for '+row.order_id)}}
}
