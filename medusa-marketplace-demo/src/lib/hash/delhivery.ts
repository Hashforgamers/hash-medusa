import { dispatchAddress } from './shipping-address'
import { z } from 'zod'
import { createHash } from 'crypto'
import { db,transaction,audit } from './db'
import { fail,own,requireHash } from './access'
import { encryptCredential,decryptCredential } from './payout-connectors'
import { reconcileOrder } from './settlements'
import { applyShippingFee } from './shipping-fees'
const id=z.string().min(1).max(200)
export const parcelSchema=z.object({weight_g:z.number().int().positive().max(30000),length_cm:z.number().positive().max(150),width_cm:z.number().positive().max(150),height_cm:z.number().positive().max(150),mode:z.enum(['Surface','Express']),invoice:z.string().trim().min(1).max(50),ewaybill:z.string().regex(/^\d{12}$/).or(z.literal('')).default('')})
export const shippingCommands=z.discriminatedUnion('action',[
 z.object({action:z.literal('request_cancellation'),order_id:id,reason:z.string().trim().min(5).max(500)}),
 z.object({action:z.literal('cancel_courier'),order_id:id,confirmed:z.literal(true)}),
 z.object({action:z.literal('resolve_cancellation'),order_id:id,accepted:z.boolean(),note:z.string().trim().min(20).max(1000),confirmed:z.literal(true)}),
 z.object({action:z.literal('resolve_dispatch'),kind:z.enum(['location','pickup']),id,note:z.string().trim().min(20).max(1000),outcome:z.enum(['confirmed','absent']),carrier_id:z.string().regex(/^[1-9]\d*$/).optional(),confirmed:z.literal(true)}),
 z.object({action:z.literal('prepare_dispatch'),order_id:id,delivery_address:dispatchAddress.optional(),pickup_address:dispatchAddress.optional()}),
 z.object({action:z.literal('dispatch'),order_id:id,revision:z.number().int().positive(),pickup_date:z.string(),ewaybill:z.string().regex(/^\d{12}$/).or(z.literal('')).default(''),confirmed:z.literal(true)}),
 z.object({action:z.literal('payer'),vendor_id:id,payer:z.enum(['seller','customer']),revision:z.number().int().positive()}),
 z.object({action:z.literal('settings'),token:z.string().trim().min(16).max(1000),revision:z.number().int().nonnegative()}),
 z.object({action:z.literal('enabled'),active:z.boolean(),revision:z.number().int().positive()}),
 z.object({action:z.literal('pickup'),vendor_id:id,name:z.string().trim().min(1).max(100),pincode:z.string().regex(/^[1-9]\d{5}$/)}),
 z.object({action:z.literal('quote'),order_id:id,parcel:parcelSchema}),
 z.object({action:z.literal('book'),order_id:id,revision:z.number().int().positive(),confirmed:z.literal(true)}),
 z.object({action:z.literal('sync'),order_id:id}),
 z.object({action:z.literal('label'),order_id:id}),
 z.object({action:z.literal('reset_booking'),order_id:id,note:z.string().trim().min(20).max(1000),confirmed:z.literal(true)}),
 z.object({action:z.literal('invoice'),order_id:id,revision:z.number().int().positive(),amount_paise:z.number().int().min(0).max(10000000),reference:z.string().trim().min(3).max(150),note:z.string().trim().min(10).max(1000),confirmed:z.literal(true)}),
])
export async function delhiveryRequest(token:string,path:string,body?:any,json=false){
 if(!(path==='/fm/request/new/'||(/^\/(api|c\/api)\//.test(path)))||path.includes('://'))throw Error('Invalid carrier path')
 const r=await fetch('https://track.delhivery.com'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Authorization:'Token '+token,Accept:'application/json',...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{})},...(body?{body:json?JSON.stringify(body):new URLSearchParams({format:'json',data:JSON.stringify(body)}).toString()}: {})})
 if(!r.ok)throw Error(`Delhivery request failed (${r.status}); check account access or try again later`)
 const text=await r.text();if(text.length>2000000)throw Error('Carrier response too large');try{return JSON.parse(text)}catch{throw Error('Unexpected carrier response')}
}
export async function delhiveryConfig(){const {rows:[c]}=await db().query("SELECT * FROM hash_shipping_config WHERE id='delhivery'");if(!c?.active||!c.verified_at)fail('Enable a verified Delhivery connection in Shipping');return {...c,token:decryptCredential(c.secret_encrypted)}}
export async function shippingOverview(a:any){
 const filter=a.superAdmin?null:a.vendor_id
 const [{rows:shipments},{rows:pickups},{rows:[settings]}]=await Promise.all([
 db().query('SELECT * FROM hash_shipment WHERE ($1::text IS NULL OR vendor_id=$1) ORDER BY created_at DESC LIMIT 500',[filter]),
 db().query('SELECT * FROM hash_shipping_pickup WHERE ($1::text IS NULL OR vendor_id=$1)',[filter]),
 db().query("SELECT active,verified_at,revision FROM hash_shipping_config WHERE id='delhivery'")])
 const reviews=a.superAdmin?{locations:(await db().query("SELECT name,status,created_at FROM hash_dispatch_location WHERE status<>'confirmed'")).rows,requests:(await db().query("SELECT id,location_name,pickup_date,status,created_at FROM hash_pickup_request WHERE status<>'confirmed'")).rows}:null
 return {reviews,shipments,pickups,settings:settings||{active:false,revision:0},fee_policy:'Actual invoiced charge, no markup; remaining order payouts held until reconciled'}
}
async function ownedOrder(a:any,id:string){const {rows:[o]}=await db().query('SELECT * FROM hash_order WHERE order_id=$1',[id]);if(!o)fail('Order not found');own(a,o.vendor_id);return o}
function eligible(o:any){if(o.cancellation_request||o.currency_code!=='inr'||o.delivery_kind!=='product'||!o.paid_at||o.hold_reason||o.canceled_at||o.completed_at||o.payment_mode!=='hash_collects')fail('Shipping requires a paid, unheld INR physical-product order collected by Hash')}
export function estimatePaise(body:any){const amount=Array.isArray(body)&&body.length===1?Number(body[0].total_amount):NaN;if(!Number.isFinite(amount)||amount<=0||amount>100000)throw Error('Delhivery did not return a valid shipping estimate');return Math.round(amount*100)}
export function carrierStage(status:string,type:string){if(type==='DL'&&status==='Delivered')return 'carrier_delivered';if(type==='RT'||type==='RTO'||/RTO|Return/i.test(status))return 'return_in_progress';if(/Dispatched|Out for Delivery/i.test(status))return 'out_for_delivery';if(/In Transit|Picked Up/i.test(status))return 'shipped';return 'carrier_update'}
export async function shippingAction(container:any,a:any,b:any){
 if(b.action==='payer'){
  own(a,b.vendor_id);if(!a.superAdmin&&a.role!=='owner')fail('Only the vendor owner can change who pays delivery');
  return transaction(`shipping-policy:${b.vendor_id}`,async c=>{if(!(await c.query('UPDATE hash_vendor SET shipping_payer=$2,shipping_policy_revision=shipping_policy_revision+1 WHERE id=$1 AND shipping_policy_revision=$3',[b.vendor_id,b.payer,b.revision])).rowCount)fail('Shipping policy changed; refresh');await audit(c,a.id,'shipping_payer_changed',b.vendor_id,{payer:b.payer});return {ok:true}})
 }
 if(b.action==='settings'){
  requireHash(a);const check=await delhiveryRequest(b.token,'/c/api/pin-codes/json/?filter_codes=110001');
  if(!Array.isArray(check.delivery_codes))fail('Delhivery token verification failed')
  return transaction('hash:shipping',async c=>{const {rows:[old]}=await c.query("SELECT revision FROM hash_shipping_config WHERE id='delhivery'");if((old?.revision||0)!==b.revision)fail('Settings changed; refresh');await c.query("INSERT INTO hash_shipping_config(id,secret_encrypted,verified_at) VALUES('delhivery',$1,now()) ON CONFLICT(id) DO UPDATE SET secret_encrypted=$1,verified_at=now(),active=false,revision=hash_shipping_config.revision+1",[encryptCredential(b.token)]);await audit(c,a.id,'shipping_connection_saved','delhivery');return {ok:true}})
 }
 if(b.action==='enabled'){requireHash(a);return transaction('hash:shipping',async c=>{if(!(await c.query("UPDATE hash_shipping_config SET active=$1,revision=revision+1 WHERE id='delhivery' AND revision=$2 AND verified_at IS NOT NULL",[b.active,b.revision])).rowCount)fail('Connection changed or not verified');await audit(c,a.id,'shipping_connection_enabled','delhivery',{active:b.active});return {ok:true}})}
 if(b.action==='pickup'){requireHash(a);await db().query('INSERT INTO hash_shipping_pickup(vendor_id,name,pincode) VALUES($1,$2,$3) ON CONFLICT(vendor_id) DO UPDATE SET name=$2,pincode=$3,revision=hash_shipping_pickup.revision+1',[b.vendor_id,b.name,b.pincode]);await audit(db(),a.id,'shipping_pickup_assigned',b.vendor_id,{name:b.name,pincode:b.pincode});return {ok:true}}
 await ownedOrder(a,b.order_id)
 if(b.action==='reset_booking'){
  requireHash(a);return transaction(`order:${b.order_id}`,async c=>{const {rows:[s]}=await c.query('SELECT * FROM hash_shipment WHERE order_id=$1 FOR UPDATE',[b.order_id]);if(!s||s.status!=='booking'||s.waybill||Date.now()-new Date(s.quoted_at).getTime()<120000)fail('Only an unresolved booking older than two minutes can be reset');await c.query("UPDATE hash_shipment SET status='quoted',quoted_at='2000-01-01',revision=revision+1 WHERE order_id=$1",[b.order_id]);await audit(c,a.id,'shipment_confirmed_not_created',b.order_id,{note:b.note});return {message:'Booking reset after operator confirmation. Obtain a fresh quote before retrying.'}})
 }
 if(b.action==='invoice'){
  requireHash(a);await reconcileOrder(container,b.order_id)
  return transaction(`order:${b.order_id}`,async c=>{const {rows:[s]}=await c.query('SELECT * FROM hash_shipment WHERE order_id=$1 FOR UPDATE',[b.order_id]);if(!s||s.status==='quoted'||s.status==='booking'||!s.waybill)fail('Resolve the shipment before recording its final invoice');if(s.revision!==b.revision)fail('Shipping record changed; refresh');if((await c.query("SELECT 1 FROM hash_settlement WHERE order_id=$1 AND status='processing'",[b.order_id])).rowCount)fail('Resolve processing transfers first');await c.query('UPDATE hash_shipment SET fee_paise=$2,fee_final=true,invoice_reference=$3,revision=revision+1 WHERE order_id=$1',[b.order_id,b.amount_paise,b.reference]);await c.query('UPDATE hash_order SET shipping_fee_paise=$2 WHERE order_id=$1',[b.order_id,b.amount_paise]);await applyShippingFee(c,b.order_id);await audit(c,a.id,'shipping_invoice_reconciled',b.order_id,{previous_paise:s.fee_paise,amount_paise:b.amount_paise,reference:b.reference,note:b.note});return {ok:true}})
 }
 const cfg=await delhiveryConfig()
 if(b.action==='sync')return syncShipment(b.order_id,cfg.token,a.id)
 if(b.action==='label'){
  const {rows:[s]}=await db().query('SELECT waybill FROM hash_shipment WHERE order_id=$1',[b.order_id]);if(!s?.waybill)fail('Book a shipment first')
  const response=await delhiveryRequest(cfg.token,'/api/p/packing_slip?'+new URLSearchParams({wbns:s.waybill,pdf:'true',pdf_size:'4R'}))
  const url=response.packages?.[0]?.pdf_download_link||response.pdf_download_link
  if(typeof url!=='string'||!/^https:\/\//.test(url))fail('Carrier label is not ready; download it from Delhivery One')
  const u=new URL(url);if(u.username||u.password||!(u.hostname.endsWith('.amazonaws.com')||u.hostname.endsWith('.delhivery.com')))fail('Carrier returned an unrecognized label host')
  await audit(db(),a.id,'carrier_label_generated',b.order_id);return {url}
 }
 await reconcileOrder(container,b.order_id);const o=await ownedOrder(a,b.order_id);eligible(o)
 const {data:[order]}=await container.resolve('query').graph({entity:'order',fields:['id','display_id','total','shipping_address.*','items.title','items.quantity'],filters:{id:b.order_id}})
 const savedAddress=b.action==='book'?(await db().query('SELECT parcel FROM hash_shipment WHERE order_id=$1',[b.order_id])).rows[0]?.parcel?.delivery_address:null
 const addr=b.delivery_address||savedAddress||order?.shipping_address
 if(!addr||addr.country_code?.toLowerCase()!=='in'||!/^\d{6}$/.test(addr.postal_code)||!addr.phone||!addr.address_1||!addr.city)fail('A complete Indian shipping address and phone are required')
 if(b.action==='quote'){
  const {rows:[storedPickup]}=await db().query('SELECT * FROM hash_shipping_pickup WHERE vendor_id=$1',[o.vendor_id]);const pickup=b.pickup_override||storedPickup;if(!pickup)fail('Hash must assign a registered Delhivery pickup location first')
  const service=await delhiveryRequest(cfg.token,'/c/api/pin-codes/json/?'+new URLSearchParams({filter_codes:addr.postal_code}));const pin=service.delivery_codes?.find((p:any)=>String(p.postal_code?.pin)===addr.postal_code)?.postal_code
  if(pin?.pre_paid!=='Y'||pin.remarks)fail('Delhivery prepaid delivery is not available for this pincode')
  const p=b.parcel;const quote=estimatePaise(await delhiveryRequest(cfg.token,'/api/kinko/v1/invoice/charges/.json?'+new URLSearchParams({md:p.mode==='Surface'?'S':'E',ss:'Delivered',d_pin:addr.postal_code,o_pin:pickup.pincode,cgm:String(p.weight_g),pt:'Pre-paid',l:String(p.length_cm),b:String(p.width_cm),h:String(p.height_cm),ipkg_type:'box'})))
  return transaction(`order:${b.order_id}`,async c=>{const {rows:[current]}=await c.query('SELECT * FROM hash_shipment WHERE order_id=$1',[b.order_id]);if(current&&current.status!=='quoted')fail('A shipment already exists; refresh its status instead of booking again');const fingerprint=createHash('sha256').update(JSON.stringify(order)).digest('hex');const {rows:[s]}=await c.query("INSERT INTO hash_shipment(order_id,vendor_id,parcel,pickup,quote_paise) VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id) DO UPDATE SET parcel=$3,pickup=$4,quote_paise=$5,quoted_at=now(),revision=hash_shipment.revision+1 RETURNING *",[b.order_id,o.vendor_id,JSON.stringify({...p,fingerprint,delivery_address:b.delivery_address||null}),JSON.stringify(pickup),quote]);return s})
 }
 if(b.action==='book'){
  const s=await transaction(`order:${b.order_id}`,async c=>{const {rows:[current]}=await c.query('SELECT * FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id]);eligible(current);if(current.delivery_status!=='ready_to_ship')fail('Accept, process and mark the order Ready to Ship before booking pickup');if((await c.query("SELECT 1 FROM hash_settlement WHERE order_id=$1 AND status='processing'",[b.order_id])).rowCount)fail('Wait for the processing payout to finish');const {rows:[s]}=await c.query('SELECT * FROM hash_shipment WHERE order_id=$1 FOR UPDATE',[b.order_id]);if(!s||s.status!=='quoted'||s.revision!==b.revision)fail('Shipment already submitted or quote changed; refresh');if(Date.now()-new Date(s.quoted_at).getTime()>15*60000)fail('Quote expired; calculate again');if(createHash('sha256').update(JSON.stringify(order)).digest('hex')!==s.parcel.fingerprint)fail('Order address or items changed; calculate again');if(Number(order.total)>=50000&&!s.parcel.ewaybill)fail('Enter the e-waybill for this shipment');await c.query("UPDATE hash_shipment SET status='booking',revision=revision+1 WHERE order_id=$1",[b.order_id]);await audit(c,a.id,'shipment_booking_requested',b.order_id,{quote_paise:s.quote_paise});return s})
  const p=s.parcel,shippingAddr=s.parcel.delivery_address||addr
  try{
   const response=await delhiveryRequest(cfg.token,'/api/cmu/create.json',{shipments:[{order:b.order_id,name:[shippingAddr.first_name,shippingAddr.last_name].filter(Boolean).join(' '),add:[shippingAddr.address_1,shippingAddr.address_2].filter(Boolean).join(', '),pin:shippingAddr.postal_code,city:shippingAddr.city,state:shippingAddr.province,country:'India',phone:shippingAddr.phone,payment_mode:'Prepaid',cod_amount:0,total_amount:order.total,products_desc:order.items.map((i:any)=>i.title).join(', ').slice(0,500),quantity:String(order.items.reduce((n:number,i:any)=>n+Number(i.quantity),0)),weight:p.weight_g,shipment_length:p.length_cm,shipment_width:p.width_cm,shipment_height:p.height_cm,shipping_mode:p.mode,seller_inv:p.invoice,ewbn:p.ewaybill}],pickup_location:{name:s.pickup.name}})
   const pack=response.packages?.[0];if(response.success!==true||pack?.status!=='Success'||!/^\d{8,20}$/.test(String(pack.waybill)))throw Error('Unconfirmed booking')
   await attachWaybill(b.order_id,String(pack.waybill),a.id)
   return {ok:true,message:'Shipment booked. Schedule pickup in Delhivery One and print the carrier label.'}
  }catch{await audit(db(),a.id,'shipment_booking_needs_review',b.order_id);return {status:'booking',message:'Booking outcome is uncertain. Refresh Delhivery tracking; do not book again. Hash can check this order reference in Delhivery One.'}}
 }
}
async function attachWaybill(orderId:string,waybill:string,actor:string){return transaction(`order:${orderId}`,async c=>{await c.query("UPDATE hash_shipment SET waybill=$2,status='booked',revision=revision+1 WHERE order_id=$1 AND status='booking'",[orderId,waybill]);await c.query("UPDATE hash_order SET delivery_details=delivery_details||$2::jsonb,delivery_revision=delivery_revision+1 WHERE order_id=$1",[orderId,JSON.stringify({courier:'Delhivery',tracking_number:waybill,tracking_url:'https://www.delhivery.com/track/package/'+waybill})]);await audit(c,actor,'shipment_booked',orderId,{waybill});return {ok:true}})}
export async function syncShipment(orderId:string,token:string,actor='system',force=false){
 const {rows:[s]}=await db().query('SELECT * FROM hash_shipment WHERE order_id=$1',[orderId]);if(!s||s.status==='quoted')fail('Book a shipment first')
 if(!force&&s.synced_at&&Date.now()-new Date(s.synced_at).getTime()<60000)return {message:'Tracking was refreshed recently'}
 const result=await delhiveryRequest(token,'/api/v1/packages/json/?'+new URLSearchParams(s.waybill?{waybill:s.waybill}:{ref_ids:orderId}))
 const shipments=result.ShipmentData?.map((x:any)=>x.Shipment)||[];const shipment=shipments.find((x:any)=>x.ReferenceNo===orderId&&(!s.waybill||String(x.AWB)===s.waybill));if(!shipment)fail('Delhivery has not confirmed this shipment yet; check the order reference in Delhivery One')
 if(!s.waybill){if(!/^\d{8,20}$/.test(String(shipment.AWB)))fail('Invalid carrier waybill');await attachWaybill(orderId,String(shipment.AWB),actor)}
 const st=shipment.Status;if(typeof st?.Status!=='string'||st.Status.length>100)fail('Unexpected tracking response')
 const stamp=String(st.StatusDateTime||'');const at=new Date(/[zZ]|[+-]\d\d:\d\d$/.test(stamp)?stamp:stamp+'+05:30');if(!Number.isFinite(+at))fail('Unexpected carrier timestamp')
 return transaction(`order:${orderId}`,async c=>{const {rows:[now]}=await c.query('SELECT * FROM hash_shipment WHERE order_id=$1 FOR UPDATE',[orderId]);if(now.carrier_at&&+new Date(now.carrier_at)>+at)return {ok:true};const stage=carrierStage(st.Status,st.StatusType);if(now.carrier_status!==st.Status||+new Date(now.carrier_at||0)!==+at){await c.query('INSERT INTO hash_delivery_event(order_id,status,note,details,created_at) VALUES($1,$2,$3,$4,$5)',[orderId,stage,stage==='carrier_delivered'?'Delhivery reports delivery; customer OTP confirmation is still required':`Delhivery: ${st.Status}`,JSON.stringify({source:'delhivery',courier:'Delhivery',tracking_number:String(shipment.AWB)}),at]);if(['shipped','out_for_delivery'].includes(stage))await c.query("UPDATE hash_order SET delivery_status=$2,delivery_revision=delivery_revision+1 WHERE order_id=$1 AND completed_at IS NULL AND canceled_at IS NULL",[orderId,stage])}await c.query('UPDATE hash_shipment SET carrier_status=$2,carrier_at=$3,synced_at=now() WHERE order_id=$1',[orderId,st.Status,at]);return {ok:true}})
}
export async function syncDelhivery(){const {rows:[c]}=await db().query("SELECT * FROM hash_shipping_config WHERE id='delhivery' AND active");if(!c)return;const token=decryptCredential(c.secret_encrypted);const {rows}=await db().query("SELECT order_id FROM hash_shipment WHERE status IN ('booked','booking') AND created_at>now()-interval '90 days' AND (synced_at IS NULL OR synced_at<now()-interval '15 minutes') ORDER BY synced_at NULLS FIRST LIMIT 50");for(const s of rows){try{await syncShipment(s.order_id,token)}catch{await db().query('UPDATE hash_shipment SET synced_at=now() WHERE order_id=$1',[s.order_id])}}}
