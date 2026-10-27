import { createHash,randomUUID } from 'crypto'
import { db,transaction } from './db'
import { fail } from './access'
import { delhiveryConfig,delhiveryRequest,estimatePaise } from './delhivery'
export function cartFingerprint(cart:any){
 const a=cart.shipping_address||{}
 return createHash('sha256').update(JSON.stringify({currency:cart.currency_code,items:(cart.items||[]).map((i:any)=>[i.product_id||i.variant?.product_id||i.product?.id,Number(i.quantity)]).sort((a:any,b:any)=>String(a[0]).localeCompare(String(b[0]))),address:[a.country_code,a.postal_code,a.province,a.city,a.address_1,a.address_2,a.first_name,a.last_name,a.phone]})).digest('hex')
}
export async function cartShippingVendor(cart:any){
 const ids=[...new Set((cart.items||[]).map((i:any)=>i.product_id||i.variant?.product_id||i.product?.id))]
 if(!ids.length||ids.some(x=>!x))fail('Add products before calculating delivery')
 const {rows}=await db().query('SELECT l.*,v.shipping_payer,v.shipping_policy_revision,v.status,v.name AS vendor_name FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE l.product_id=ANY($1::text[])',[ids])
 if(rows.length!==ids.length||new Set(rows.map(r=>r.vendor_id)).size!==1||rows.some(r=>r.status!=='active'||r.approval!=='approved'))fail('Cart must contain approved products from one active vendor')
 return {vendor:rows[0],listings:rows,physical:rows.some(r=>r.kind==='product')}
}
export function packedEstimate(items:any[],listings:any[]){
 let weight=0,length=0,width=0,height=0
 for(const i of items){const l=listings.find(l=>l.product_id===(i.product_id||i.variant?.product_id||i.product?.id));if(l?.kind==='service')continue;const p=l?.shipping_package,q=Number(i.quantity);if(!p||!['weight_g','length_cm','width_cm','height_cm'].every(k=>Number.isFinite(Number(p[k]))&&Number(p[k])>0)||!Number.isInteger(q)||q<=0)fail('Vendor must add packed unit weight and dimensions to every physical listing');weight+=Number(p.weight_g)*q;length=Math.max(length,Number(p.length_cm));width=Math.max(width,Number(p.width_cm));height+=Number(p.height_cm)*q}
 if(weight>30000||Math.max(length,width,height)>150)fail('This cart exceeds the supported single-parcel size; contact the vendor')
 return {weight_g:Math.ceil(weight),length_cm:length,width_cm:width,height_cm:height}
}
export async function checkoutShippingQuote(cart:any){
 const {vendor,listings,physical}=await cartShippingVendor(cart)
 if(cart.currency_code!=='inr')fail('Hash calculated delivery currently supports INR only')
 const fingerprint=cartFingerprint(cart)
 return transaction(`cart-shipping:${cart.id}`,async c=>{
  const {rows:[old]}=await c.query('SELECT * FROM hash_cart_shipping_quote WHERE cart_id=$1',[cart.id]);if(old&&old.fingerprint===fingerprint&&old.policy_revision===vendor.shipping_policy_revision&&new Date(old.expires_at)>new Date())return old
  let amount=0;const payer=physical?vendor.shipping_payer:'seller'
  if(payer==='customer'){
   const a=cart.shipping_address;if(a?.country_code?.toLowerCase()!=='in'||!/^\d{6}$/.test(a?.postal_code))fail('Add an Indian delivery address to calculate shipping')
   const {rows:[pickup]}=await c.query('SELECT * FROM hash_shipping_pickup WHERE vendor_id=$1',[vendor.vendor_id]);if(!pickup)fail('Vendor pickup location is not configured; contact the vendor')
   const p=packedEstimate(cart.items,listings),cfg=await delhiveryConfig()
   const service=await delhiveryRequest(cfg.token,'/c/api/pin-codes/json/?'+new URLSearchParams({filter_codes:a.postal_code}));const pin=service.delivery_codes?.find((p:any)=>String(p.postal_code?.pin)===a.postal_code)?.postal_code;if(pin?.pre_paid!=='Y'||pin.remarks)fail('Delhivery prepaid delivery is unavailable for this pincode')
   amount=estimatePaise(await delhiveryRequest(cfg.token,'/api/kinko/v1/invoice/charges/.json?'+new URLSearchParams({md:'S',ss:'Delivered',d_pin:a.postal_code,o_pin:pickup.pincode,cgm:String(p.weight_g),pt:'Pre-paid',l:String(p.length_cm),b:String(p.width_cm),h:String(p.height_cm),ipkg_type:'box'})))
  }
  const {rows:[quote]}=await c.query('INSERT INTO hash_cart_shipping_quote(cart_id,id,vendor_id,payer,fingerprint,amount_paise,policy_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'15 minutes\') ON CONFLICT(cart_id) DO UPDATE SET id=$2,vendor_id=$3,payer=$4,fingerprint=$5,amount_paise=$6,policy_revision=$7,expires_at=now()+interval \'15 minutes\',created_at=now() RETURNING *',[cart.id,randomUUID(),vendor.vendor_id,payer,fingerprint,amount,vendor.shipping_policy_revision]);
  await c.query('INSERT INTO hash_checkout_shipping_receipt(id,cart_id,fingerprint,amount_paise) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[quote.id,cart.id,fingerprint,amount]);return quote
 })
}
export async function validateCheckoutShipping(cart:any){
 const {physical,vendor}=await cartShippingVendor(cart);if(!physical)return
 const methods=cart.shipping_methods||[];
 // Preserve existing seller-paid carts created before calculated delivery was introduced.
 if(vendor.shipping_payer==='seller'&&methods.length===1&&!methods[0].data?.hash_shipping_quote_id&&Number(methods[0].amount)===0&&!methods[0].adjustments?.length)return
 if(methods.length!==1||!methods[0].data?.hash_shipping_quote_id)fail('Select Hash delivery again before paying')
 const {rows:[q]}=await db().query('SELECT * FROM hash_checkout_shipping_receipt WHERE cart_id=$1 AND id=$2',[cart.id,methods[0].data.hash_shipping_quote_id])
 if(!q||q.fingerprint!==cartFingerprint(cart))fail('Cart or address changed; select delivery again before paying')
 // The accepted quote is fixed for this checkout. Never recalculate after Razorpay captured payment.
 if(Math.round(Number(methods[0].amount)*100)!==Number(q.amount_paise))fail('Delivery price changed; refresh checkout')
 if(methods[0].adjustments?.length)fail('Shipping discounts are not supported for carrier delivery')
}
