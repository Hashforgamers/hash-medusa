import { Modules } from '@medusajs/framework/utils'
import { cancelOrderWorkflow } from '@medusajs/core-flows'
import { db,transaction,audit } from './db'
import { fail,requireHash } from './access'
import { minorUnits } from './policy'
import { reconcileOrder,reviewAdjustment } from './settlements'

export async function completeCancellation(container:any,a:any,b:any){
 requireHash(a)
 await reconcileOrder(container,b.order_id)
 await transaction(`order:${b.order_id}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id])
  const r=o?.cancellation_request
  if(!r)fail('No cancellation request exists for this order')
  if(r.completion?.status==='complete')return
  if(r.completion?.status==='processing'&&Date.now()-Date.parse(r.completion.updated_at)<600000)fail('Cancellation is processing. Refresh to see its saved progress.')
  if(!['courier_requested','not_booked','closed'].includes(r.status))fail('Resolve the courier cancellation first')
  if(o.completed_at)fail('Delivery was completed. Review this as a return instead.')
  if((await c.query("SELECT 1 FROM hash_settlement WHERE order_id=$1 AND status='processing'",[b.order_id])).rowCount)fail('Resolve the vendor transfer in progress before canceling')
  const {data:[order]}=await container.resolve('query').graph({entity:'order',fields:['id','status','currency_code','fulfillments.canceled_at','payment_collections.payments.id','payment_collections.payments.provider_id','payment_collections.payments.data','payment_collections.payments.captures.*','payment_collections.payments.refunds.*'],filters:{id:b.order_id}})
  if(!order)fail('Order not found')
  if(order.fulfillments?.some(f=>!f.canceled_at))fail('Cancel the active Medusa fulfillment before completing this cancellation')
  for(const p of (order.payment_collections||[]).flatMap(pc=>pc.payments||[])){
   const captured=(p.captures||[]).reduce((n,r)=>n+minorUnits(r.amount,order.currency_code),0)
   const refunded=(p.refunds||[]).reduce((n,r)=>n+minorUnits(r.amount,order.currency_code),0)
   const remaining=captured-refunded
   if(remaining<=0)continue
   if(!p.provider_id.includes('razorpay')||order.currency_code.toLowerCase()!=='inr')fail('This payment needs provider refund reconciliation before order cancellation')
   const d=p.data
   if(!/^pay_[A-Za-z0-9]+$/.test(d?.payment_id||'')||!/^payses_[A-Za-z0-9]+$/.test(d?.session_id||''))fail('The captured payment is missing its Razorpay reference. Reconcile the payment first.')
   const {rows:[existing]}=await c.query('SELECT * FROM hash_cancellation_refund WHERE session_id=$1',[d.session_id])
   if(existing&&(Number(existing.amount_minor)!==remaining||existing.order_id!==b.order_id))fail('The payment changed after cancellation approval. Review its refund records.')
   await c.query('INSERT INTO hash_cancellation_refund(session_id,order_id,payment_id,key_id,amount_minor) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id) DO NOTHING',[d.session_id,b.order_id,d.payment_id,d.key_id,remaining])
  }
  const completion={...r.completion,status:'queued',approved_by:r.completion?.approved_by||a.id,approved_at:r.completion?.approved_at||new Date().toISOString(),note:b.note,updated_at:new Date().toISOString(),error:null}
  await c.query("UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb,hold_reason='Cancellation approved; refund processing' WHERE order_id=$1",[b.order_id,{completion}])
  await audit(c,a.id,'cancellation_completion_approved',b.order_id,{note:b.note})
 })
 await processCancellation(container,b.order_id)
 return {message:'Cancellation progress saved. Refresh the order to see its current status.'}
}

export async function processCancellation(container:any,orderId:string){
 const completion=await transaction(`order:${orderId}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[orderId])
  const state=o?.cancellation_request?.completion
  if(!state||state.status==='complete'||state.status==='needs_attention')return null
  if(state.status==='processing'&&Date.now()-Date.parse(state.updated_at)<600000)return null
  const next={...state,status:'processing',updated_at:new Date().toISOString()}
  await c.query("UPDATE hash_order SET cancellation_request=jsonb_set(cancellation_request,'{completion}',$2::jsonb) WHERE order_id=$1",[orderId,next])
  return next
 })
 if(!completion)return
 try{
  const {data:[order]}=await container.resolve('query').graph({entity:'order',fields:['id','status','currency_code','payment_collections.payments.id','payment_collections.payments.captures.*','payment_collections.payments.refunds.*'],filters:{id:orderId}})
  // Medusa's bulk cancellation refund step logs provider errors and continues.
  // Complete each payment refund first so a pending refund cannot be lost.
  for(const payment of (order?.payment_collections||[]).flatMap(pc=>pc.payments||[])){
   const captured=(payment.captures||[]).reduce((n,r)=>n+minorUnits(r.amount,order.currency_code),0)
   const refunded=(payment.refunds||[]).reduce((n,r)=>n+minorUnits(r.amount,order.currency_code),0)
   if(captured>refunded)await container.resolve(Modules.PAYMENT).refundPayment({payment_id:payment.id,amount:(captured-refunded)/100,created_by:completion.approved_by,note:completion.note})
  }
  if(order?.status!=='canceled')await cancelOrderWorkflow(container).run({input:{order_id:orderId,canceled_by:completion.approved_by}})
  await reconcileOrder(container,orderId)
  await reviewAdjustment(container,{id:completion.approved_by},orderId,completion.note)
  await transaction(`order:${orderId}`,async c=>{
   const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[orderId])
   if(!o.canceled_at||Number(o.refunded_paise)<Number(o.captured_paise))throw Error('Waiting for confirmed order cancellation and full refund reconciliation')
   const completed_at=new Date().toISOString()
   await c.query("UPDATE hash_order SET cancellation_request=cancellation_request||$2::jsonb,delivery_status='canceled',delivery_revision=delivery_revision+1 WHERE order_id=$1",[orderId,{status:'closed',completion:{...completion,status:'complete',updated_at:completed_at,completed_at,error:null}}])
   await c.query('INSERT INTO hash_delivery_event(order_id,status,note) VALUES($1,$2,$3)',[orderId,'canceled','Order cancellation completed and customer payment refund reconciled'])
   await audit(c,completion.approved_by,'cancellation_completed',orderId,{refunded_paise:o.refunded_paise})
  })
 }catch(error){
  const {rows:refunds}=await db().query('SELECT status FROM hash_cancellation_refund WHERE order_id=$1',[orderId])
  const pending=refunds.some(r=>r.status==='pending')&&!refunds.some(r=>r.status==='failed')
  const message=String(error.message||'Cancellation requires review').slice(0,1000)
  await transaction(`order:${orderId}`,async c=>{
   await c.query("UPDATE hash_order SET cancellation_request=jsonb_set(cancellation_request,'{completion}',$2::jsonb) WHERE order_id=$1",[orderId,{...completion,status:pending?'refund_pending':'needs_attention',updated_at:new Date().toISOString(),error:message}])
   await audit(c,completion.approved_by,'cancellation_completion_pending',orderId,{pending})
  })
 }
}

export async function processApprovedCancellations(container:any){
 const {rows}=await db().query("SELECT order_id FROM hash_order WHERE cancellation_request->'completion'->>'status' IN ('queued','refund_pending','processing') ORDER BY cancellation_request->'completion'->>'updated_at' ASC NULLS FIRST LIMIT 25")
 for(const row of rows){try{await processCancellation(container,row.order_id)}catch(e){container.resolve('logger').error('Cancellation recovery failed for '+row.order_id)}}
}
