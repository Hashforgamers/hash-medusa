import { createHash } from 'crypto'
import { dispatchAddress } from './shipping-address'
import { db,transaction,audit } from './db'
import { own,fail,requireHash } from './access'
import { packedEstimate } from './checkout-shipping'
import { shippingAction,delhiveryConfig,delhiveryRequest,parcelSchema } from './delhivery'
export function validatePickupDate(date:string,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Choose a valid pickup date')
 const at=Date.parse(date+'T14:00:00+05:30');if(at<now+60*60000||at>now+30*86400000)fail('Choose a pickup date with at least one hour notice and within 30 days')
}
export async function prepareDispatch(container:any,a:any,orderId:string,edits:any={}){
 const {rows:[o]}=await db().query('SELECT * FROM hash_order WHERE order_id=$1',[orderId]);if(!o)fail('Order not found');own(a,o.vendor_id)
 if(o.cancellation_request||o.delivery_status!=='ready_to_ship'||o.completed_at||o.canceled_at||o.hold_reason||!o.paid_at)fail('Mark this paid order Ready to Ship first')
 let {rows:[pickup]}=await db().query('SELECT * FROM hash_shipping_pickup WHERE vendor_id=$1',[o.vendor_id]);if(!pickup)fail('Set up the vendor pickup location once in Hash Operations')
 const {rows:[shipment]}=await db().query('SELECT * FROM hash_shipment WHERE order_id=$1',[orderId]);
 const {data:[order]}=await container.resolve('query').graph({entity:'order',fields:['id','display_id','total','items.product_id','items.quantity','shipping_address.*'],filters:{id:orderId}})
 if(!order)fail('Order not found')
 if(shipment&&shipment.status!=='quoted')return {order_id:orderId,pickup:shipment.pickup,shipment,delivery_address:shipment.parcel.delivery_address||order.shipping_address,needs_ewaybill:Number(order.total)>=50000}
 const {rows:listings}=await db().query('SELECT product_id,kind,shipping_package FROM hash_listing WHERE product_id=ANY($1::text[])',[(order.items||[]).map((i:any)=>i.product_id)])
 const {rows:[vendor]}=await db().query('SELECT business_details FROM hash_vendor WHERE id=$1',[o.vendor_id]);const business=vendor?.business_details||{}
 const pickup_suggestion={first_name:business.contact_name||'',address_1:business.address_line1||'',address_2:business.address_line2||'',city:business.city||'',province:business.state||'',postal_code:business.postal_code||pickup.pincode,phone:business.phone||''}
 const delivery=edits.delivery_address?dispatchAddress.parse(edits.delivery_address):order.shipping_address
 if(edits.pickup_address){const address=dispatchAddress.parse(edits.pickup_address);pickup={name:'HASH-'+createHash('sha256').update(JSON.stringify([o.vendor_id,address])).digest('hex').slice(0,24),pincode:address.postal_code,address,vendor_id:o.vendor_id}}
 let measurements:any
 if(edits.packed_parcel)measurements=parcelSchema.pick({weight_g:true,length_cm:true,width_cm:true,height_cm:true}).parse(edits.packed_parcel)
 else{try{measurements=packedEstimate(order.items,listings)}catch{return {order_id:orderId,requires_packed_parcel:true,message:'Enter the actual weight and outer dimensions of this complete packed order. Listing package details are missing or exceed the supported parcel size.'}}}
 const parcel={...measurements,mode:'Surface',invoice:String(order.display_id||orderId),ewaybill:''}
 const quote=await shippingAction(container,a,{action:'quote',order_id:orderId,parcel,delivery_address:delivery,pickup_override:pickup})
 return {order_id:orderId,pickup,shipment:quote,pickup_suggestion,delivery_address:delivery,needs_ewaybill:Number(order.total)>=50000}
}
export async function dispatchOrder(container:any,a:any,b:any){
 validatePickupDate(b.pickup_date)
 const {rows:[o]}=await db().query('SELECT * FROM hash_order WHERE order_id=$1',[b.order_id]);if(!o)fail('Order not found');own(a,o.vendor_id)
 if(o.cancellation_request||o.delivery_status!=='ready_to_ship'||!o.paid_at||o.hold_reason||o.completed_at||o.canceled_at)fail('Order must be paid and Ready to Ship')
 let {rows:[s]}=await db().query('SELECT * FROM hash_shipment WHERE order_id=$1',[b.order_id]);if(!s)fail('Review the pickup before booking')
 if(s.status==='quoted'){
  if(s.revision!==b.revision)fail('Shipment changed; review it again')
  if(s.pickup.address)await registerDispatchLocation(a,s.pickup)

  if(b.ewaybill){await transaction(`order:${b.order_id}`,async c=>{if(!(await c.query("UPDATE hash_shipment SET parcel=jsonb_set(parcel,'{ewaybill}',to_jsonb($2::text)) WHERE order_id=$1 AND status='quoted' AND revision=$3",[b.order_id,b.ewaybill,b.revision])).rowCount)fail('Shipment changed; refresh')})}
  const result=await shippingAction(container,a,{action:'book',order_id:b.order_id,revision:b.revision,confirmed:true})
  if(result?.status==='booking')return result
  s=(await db().query('SELECT * FROM hash_shipment WHERE order_id=$1',[b.order_id])).rows[0]
 }
 if(s.status!=='booked'||!s.waybill)fail('Booking is under review; refresh carrier tracking before retrying')
 const cfg=await delhiveryConfig()
 const decision=await transaction(`order:${b.order_id}`,async c=>{
  const {rows:[order]}=await c.query('SELECT cancellation_request,hold_reason FROM hash_order WHERE order_id=$1 FOR UPDATE',[b.order_id]);if(order.cancellation_request||order.hold_reason)fail('Resolve the order hold before requesting pickup')
  const {rows:[current]}=await c.query('SELECT pickup_request_id FROM hash_shipment WHERE order_id=$1 FOR UPDATE',[b.order_id])
  if(current.pickup_request_id){const {rows:[r]}=await c.query('SELECT * FROM hash_pickup_request WHERE id=$1',[current.pickup_request_id]);return {existing:r}}
  const {rows:[claim]}=await c.query("INSERT INTO hash_pickup_request(location_name,pickup_date,status) VALUES($1,$2,'requesting') ON CONFLICT(location_name,pickup_date) DO NOTHING RETURNING *",[s.pickup.name,b.pickup_date])
  const r=claim||(await c.query('SELECT * FROM hash_pickup_request WHERE location_name=$1 AND pickup_date=$2',[s.pickup.name,b.pickup_date])).rows[0]
  await c.query('UPDATE hash_shipment SET pickup_request_id=$2 WHERE order_id=$1',[b.order_id,r.id]);return claim?{claim}:{existing:r}
 })
 if(decision.existing){const r=decision.existing;return {status:r.status==='confirmed'?'confirmed':'pickup_review',message:r.status==='confirmed'?`Pickup is already requested for ${r.pickup_date}. Print the carrier label. Use Delhivery One to reschedule if needed.`:'AWB is ready. Pickup confirmation is under review; check Delhivery One before requesting another collection.'}}
 const claim=decision.claim!
 try{
  const {rows:[count]}=await db().query("SELECT count(*) AS n FROM hash_shipment s JOIN hash_order o ON o.order_id=s.order_id WHERE s.pickup->>'name'=$1 AND s.status='booked' AND o.delivery_status='ready_to_ship' AND o.completed_at IS NULL AND o.canceled_at IS NULL",[s.pickup.name])
  const response=await delhiveryRequest(cfg.token,'/fm/request/new/',{pickup_time:'14:00:00',pickup_date:b.pickup_date,pickup_location:s.pickup.name,expected_package_count:Math.max(1,Number(count.n))},true)
  if(!/^[1-9]\d*$/.test(String(response.pickup_id)))throw Error('No pickup confirmation')
  await db().query("UPDATE hash_pickup_request SET status='confirmed',carrier_id=$2 WHERE id=$1",[claim.id,String(response.pickup_id)])
  await audit(db(),a.id,'pickup_requested',b.order_id,{pickup_id:String(response.pickup_id),date:b.pickup_date})
  return {ok:true,message:'Delhivery shipment and pickup requested. Print the carrier label and attach it to the parcel.'}
 }catch{await db().query("UPDATE hash_pickup_request SET status='review' WHERE id=$1",[claim.id]);return {status:'pickup_review',message:'AWB is ready, but pickup confirmation is uncertain. Check Delhivery One; do not submit a duplicate request.'}}
}

async function registerDispatchLocation(a:any,pickup:any){
 const cfg=await delhiveryConfig(),address=dispatchAddress.parse(pickup.address)
 const claim=await transaction(`dispatch-location:${pickup.name}`,async c=>{
  const {rows:[prior]}=await c.query('SELECT * FROM hash_dispatch_location WHERE name=$1',[pickup.name]);if(prior){own(a,prior.vendor_id);if(prior.status!=='confirmed')fail('Pickup address registration is under review. Hash Operations must confirm it in Delhivery before retrying');return false}
  await c.query("INSERT INTO hash_dispatch_location(name,vendor_id,address,status) VALUES($1,$2,$3,'registering')",[pickup.name,pickup.vendor_id,JSON.stringify(address)]);return true
 });if(!claim)return
 try{
  const r=await delhiveryRequest(cfg.token,'/api/backend/clientwarehouse/create/',{name:pickup.name,phone:address.phone,address:[address.address_1,address.address_2].filter(Boolean).join(', '),city:address.city,pin:address.postal_code,country:'India',return_address:[address.address_1,address.address_2].filter(Boolean).join(', '),return_city:address.city,return_pin:address.postal_code,return_state:address.province,return_country:'India'},true)
  if(r.success!==true)throw Error('Warehouse not confirmed')
  await db().query("UPDATE hash_dispatch_location SET status='confirmed' WHERE name=$1",[pickup.name]);await audit(db(),a.id,'dispatch_pickup_address_registered',pickup.name)
 }catch{await db().query("UPDATE hash_dispatch_location SET status='review' WHERE name=$1",[pickup.name]);fail('Pickup address registration could not be confirmed. No shipment was booked; Hash Operations must check Delhivery before retrying')}
}

export async function resolveDispatch(a:any,b:any){
 requireHash(a)
 return transaction(`dispatch-recovery:${b.kind}:${b.id}`,async c=>{
  const table=b.kind==='location'?'hash_dispatch_location':'hash_pickup_request',key=b.kind==='location'?'name':'id'
  const {rows:[r]}=await c.query(`SELECT * FROM ${table} WHERE ${key}=$1 FOR UPDATE`,[b.id])
  if(!r||r.status==='confirmed'||Date.now()-new Date(r.created_at).getTime()<120000)fail('Only unresolved requests older than two minutes can be reviewed')
  if(b.outcome==='confirmed'){
   if(b.kind==='pickup'&&!b.carrier_id)fail('Enter the pickup ID verified in Delhivery One')
   await c.query(`UPDATE ${table} SET status='confirmed'${b.kind==='pickup'?',carrier_id=$2':''} WHERE ${key}=$1`,b.kind==='pickup'?[b.id,b.carrier_id]:[b.id])
  }else{
   if(b.kind==='pickup')await c.query('UPDATE hash_shipment SET pickup_request_id=NULL WHERE pickup_request_id=$1',[b.id])
   await c.query(`DELETE FROM ${table} WHERE ${key}=$1`,[b.id])
  }
  await audit(c,a.id,'dispatch_response_resolved',b.id,{kind:b.kind,outcome:b.outcome,note:b.note,carrier_id:b.carrier_id})
  return {message:b.outcome==='confirmed'?'Carrier confirmation recorded.':'Confirmed absent in Delhivery. Vendor can retry booking.'}
 })
}
