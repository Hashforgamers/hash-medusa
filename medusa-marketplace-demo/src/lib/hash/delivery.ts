import { z } from 'zod'
import { db, transaction, audit } from './db'
import { own, fail } from './access'
import { reconcileOrder } from './settlements'

export const deliveryCommand = z.object({
 action:z.literal('update_delivery'),order_id:z.string().min(1).max(200),revision:z.number().int().nonnegative(),
 status:z.enum(['placed','accepted','preparing','ready_to_ship','shipped','out_for_delivery','delivery_attempted','ready_for_service','in_progress']),
 courier:z.string().trim().max(100).default(''),tracking_number:z.string().trim().max(150).default(''),
 tracking_url:z.union([z.literal(''),z.string().url().max(2000).refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password},'Use an HTTPS tracking URL without credentials')]).default(''),
 expected_delivery:z.union([z.literal(''),z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s);return !isNaN(+d)&&d.toISOString().slice(0,10)===s},'Invalid date')]).default(''),
 note:z.string().trim().max(500).default(''),
})
const productSteps=['placed','accepted','preparing','ready_to_ship','shipped','out_for_delivery','delivery_attempted']
const serviceSteps=['placed','preparing','ready_for_service','in_progress']
export function validateDeliveryTransition(o:any,next:string){
 if(o.completed_at||o.canceled_at||o.reviewed_canceled)fail('This order is already completed or canceled')
 if(!o.paid_at||o.hold_reason)fail('Resolve payment or order holds before updating delivery')
 const allowed=o.delivery_kind==='service'?serviceSteps:productSteps
 if(!allowed.includes(next))fail('This stage does not apply to this order')
 const current=o.delivery_status||'placed'
 if(current===next)return
 const transitions:Record<string,string[]>={placed:o.delivery_kind==='service'?['preparing']:['accepted'],accepted:['preparing'],preparing:o.delivery_kind==='service'?['ready_for_service']:['ready_to_ship'],ready_to_ship:['shipped'],shipped:['out_for_delivery','delivery_attempted'],out_for_delivery:['delivery_attempted'],delivery_attempted:['out_for_delivery'],ready_for_service:['in_progress'],in_progress:[]}
 if(!transitions[current]?.includes(next))fail('Update stages in order; refresh the order before continuing')
}
export async function tracking(orderId:string,customerId?:string){
 const {rows:[o]}=await db().query('SELECT * FROM hash_order WHERE order_id=$1 AND ($2::text IS NULL OR customer_id=$2)',[orderId,customerId??null])
 if(!o)fail('Order not found','not_found' as any)
 const {rows:events}=await db().query('SELECT id,status,note,details,created_at FROM hash_delivery_event WHERE order_id=$1 ORDER BY id',[orderId])
 const timeline:any[]=[{id:'placed',status:'placed',at:o.order_placed_at||o.created_at,note:'Order placed'}]
 if(o.paid_at)timeline.push({id:'paid',status:'payment_confirmed',at:o.paid_at,note:'Payment confirmed'})
 timeline.push(...events.map(e=>({id:String(e.id),status:e.status,at:e.created_at,note:e.note,...e.details})))
 if(o.completed_at)timeline.push({id:'completed',status:o.delivery_kind==='service'?'completed':'delivered',at:o.completed_at,note:'Completion confirmed with customer OTP'})
 if(o.canceled_at)timeline.push({id:'canceled',status:'canceled',at:o.canceled_at,note:'Order canceled'})
 timeline.sort((a,b)=>+new Date(a.at)-+new Date(b.at))
 return {order_id:orderId,kind:o.delivery_kind,status:o.canceled_at?'canceled':o.completed_at?(o.delivery_kind==='service'?'completed':'delivered'):o.delivery_status,revision:o.delivery_revision,paid:!!o.paid_at,on_hold:!!o.hold_reason,completion_eligible:!!o.paid_at&&!o.completed_at&&!o.hold_reason&&!o.canceled_at&&!o.reviewed_canceled,courier:o.delivery_details.courier||null,tracking_number:o.delivery_details.tracking_number||null,tracking_url:o.delivery_details.tracking_url||null,expected_delivery:o.delivery_details.expected_delivery||null,timeline}
}
export async function updateDelivery(container:any,a:any,b:z.infer<typeof deliveryCommand>){
 const {rows:[owned]}=await db().query('SELECT vendor_id FROM hash_order WHERE order_id=$1',[b.order_id]);if(!owned)fail('Order not found');own(a,owned.vendor_id)
 await reconcileOrder(container,b.order_id)
 return transaction(`order:${b.order_id}`,async c=>{
  const {rows:[o]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id]);own(a,o.vendor_id)
  if(o.delivery_revision!==b.revision)fail('Tracking changed; refresh the order before saving')
  if((await c.query("SELECT 1 FROM hash_shipment WHERE order_id=$1 AND status<>'quoted'",[b.order_id])).rowCount)fail('Use Delhivery tracking refresh for this shipment')
  validateDeliveryTransition(o,b.status)
  const details={courier:b.courier,tracking_number:b.tracking_number,tracking_url:b.tracking_url,expected_delivery:b.expected_delivery}
  if(o.delivery_status===b.status&&JSON.stringify(o.delivery_details)===JSON.stringify(details)&&!b.note)return {ok:true,revision:o.delivery_revision}
  await c.query('UPDATE hash_order SET delivery_status=$2,delivery_details=$3,delivery_revision=delivery_revision+1 WHERE order_id=$1',[b.order_id,b.status,JSON.stringify(details)])
  await c.query('INSERT INTO hash_delivery_event(order_id,status,note,details) VALUES($1,$2,$3,$4)',[b.order_id,b.status,b.note,JSON.stringify(details)])
  await audit(c,a.id,'delivery_updated',b.order_id,{status:b.status,revision:b.revision+1})
  return {ok:true,revision:b.revision+1}
 })
}
export function shippingLabel(order:any,vendor:any,delivery:any){
 const address=order.shipping_address||{},business=vendor.business_details||{}
 if(!address.address_1||!address.city||!address.country_code)fail('Add a complete shipping address before printing a label')
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
 const lines=(parts:any[])=>parts.filter(Boolean).map(esc).join('<br>')
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shipping label ${esc(order.display_id||order.id)}</title><style>@page{size:A6;margin:6mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;margin:0;padding:6mm;max-width:105mm}h1{font-size:20px;margin:0}h2{font-size:11px;margin:10px 0 4px;text-transform:uppercase}p{margin:5px 0;overflow-wrap:anywhere}.box{border:2px solid #111;padding:10px;margin:12px 0}.recipient{font-size:16px;line-height:1.4}.meta{font-size:10px}.footer{border-top:1px solid #111;margin-top:12px;padding-top:6px}@media print{body{padding:0}}</style></head><body><h1>HASH · Shipping label</h1><p>Order #${esc(order.display_id||order.id)}</p><p class="meta">${esc(order.id)}</p><div class="box"><h2>Deliver to</h2><p class="recipient">${lines([[address.first_name,address.last_name].filter(Boolean).join(' '),address.company,address.address_1,address.address_2,[address.city,address.province,address.postal_code].filter(Boolean).join(', '),address.country_code.toUpperCase()])}</p><p><strong>Phone: ${esc(address.phone||'Not provided')}</strong></p></div><h2>Sender / return contact</h2><p>${lines([vendor.name,business.address_line1,business.address_line2,[business.city,business.state,business.postal_code].filter(Boolean).join(', '),business.phone])}</p><p>${business.address_line1?'':'Sender must add a return address before dispatch.'}</p><h2>Shipment</h2><p>${esc(delivery.courier||'Courier not assigned')}<br>Tracking: ${esc(delivery.tracking_number||'Not assigned')}</p><p>Items: ${(order.items||[]).reduce((n:number,i:any)=>n+Number(i.quantity),0)}</p><p>${order.paid?'PREPAID · Do not collect payment':'PAYMENT NOT CONFIRMED · Do not dispatch'}</p><p class="footer meta">Address label only. This does not purchase courier postage or replace a carrier-required label. Do not write the delivery OTP on this package.</p></body></html>`
}
