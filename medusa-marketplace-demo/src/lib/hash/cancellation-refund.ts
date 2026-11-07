import { createHash } from 'crypto'
import { transaction } from './db'

// Medusa may delete its refund row after an uncertain provider response. Keep the
// approved amount and provider idempotency key independent of that temporary row.
export async function cancellationRefund(data:any,amount:number,medusaRefundId:string,request:(path:string,body?:any,headers?:Record<string,string>)=>Promise<any>){
 if(!medusaRefundId)throw Error('Missing refund reconciliation reference')
 return transaction(`cancellation-refund:${data.session_id}`,async c=>{
  const {rows:[intent]}=await c.query('SELECT * FROM hash_cancellation_refund WHERE session_id=$1 FOR UPDATE',[data.session_id])
  if(!intent||Number(intent.amount_minor)!==amount||intent.key_id!==data.key_id)throw Error('Approve this cancellation in Hash Operations before refund reconciliation')
  if(intent.medusa_refund_id&&intent.medusa_refund_id!==medusaRefundId){
   const existing=await c.query('SELECT id FROM refund WHERE id=$1 AND deleted_at IS NULL',[intent.medusa_refund_id])
   if(existing.rowCount)throw Error('This refund is already recorded or processing in Medusa')
  }
  const payment=await request('/payments/'+encodeURIComponent(intent.payment_id))
  if(payment.id!==intent.payment_id||payment.order_id!==data.id||payment.currency!=='INR'||payment.amount!==data.amount||!['captured','refunded'].includes(payment.status))throw Error('Razorpay payment does not match this order')
  const key='hash_cancel_'+createHash('sha256').update(data.session_id).digest('hex')
  const refund=intent.refund_id?await request('/refunds/'+encodeURIComponent(intent.refund_id)):
   await request('/payments/'+encodeURIComponent(intent.payment_id)+'/refund',{amount:Number(intent.amount_minor),speed:'normal'},{'X-Refund-Idempotency':key})
  if(!/^rfnd_[A-Za-z0-9]+$/.test(refund.id)||refund.payment_id!==intent.payment_id||refund.amount!==amount||refund.currency!=='INR')throw Error('Razorpay refund response does not match the approved cancellation')
  await c.query('UPDATE hash_cancellation_refund SET refund_id=$2,status=$3,medusa_refund_id=$4,updated_at=now() WHERE session_id=$1',[data.session_id,refund.id,refund.status,medusaRefundId])
  // Commit pending status before reporting it to Medusa; it must not record a
  // successful monetary refund until Razorpay confirms processing.
  return {refund,data}
 }).then(({refund,data})=>{
  if(refund.status!=='processed')throw Error(refund.status==='failed'?'Razorpay refund failed. Hash Operations must review it.':'Razorpay refund is pending. The saved request will be checked again automatically.')
  return {data:{...data,cancellation_refund_id:refund.id}}
 })
}
