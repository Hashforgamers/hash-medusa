import { commercialTerms } from '../../../../../../lib/hash/commercial'
import { db } from '../../../../../../lib/hash/db'
import { cartShippingVendor,cartFingerprint } from '../../../../../../lib/hash/checkout-shipping'
export async function GET(req:any,res:any){
 const {data:[cart]}=await req.scope.resolve('query').graph({entity:'cart',fields:['id','customer_id','currency_code','items.*','shipping_address.*','shipping_methods.*'],filters:{id:req.params.id,customer_id:req.auth_context.actor_id}})
 if(!cart)return res.status(404).json({message:'Cart not found'})
 const {vendor,physical,listings}=await cartShippingVendor(cart)
 const {rows:[quote]}=await db().query('SELECT id,payer,amount_paise,expires_at,fingerprint,platform_fee_paise,commercial_snapshot FROM hash_cart_shipping_quote WHERE cart_id=$1',[cart.id])
 const {data:options}=await req.scope.resolve('query').graph({entity:'shipping_option',fields:['id','provider_id'],filters:{provider_id:'hash_delivery_hash_delivery'}})
 res.setHeader('Cache-Control','no-store');res.json({vendor_id:vendor.vendor_id,vendor_name:vendor.vendor_name,payer:physical?vendor.shipping_payer:'seller',currency_code:cart.currency_code,platform_fee_minor:commercialTerms(vendor).platform_fee_minor,platform_fee_tax_inclusive:true,shipping_selection_required:physical||!!commercialTerms(vendor).version,provider_id:'hash_delivery_hash_delivery',shipping_option_ids:options.map((o:any)=>o.id),missing_package_product_ids:listings.filter((l:any)=>l.kind==='product'&&!l.shipping_package).map((l:any)=>l.product_id),quote:quote&&quote.fingerprint===cartFingerprint(cart)?{id:quote.id,payer:quote.payer,amount_paise:Number(quote.amount_paise),platform_fee_minor:Number(quote.platform_fee_paise),combined_charge_minor:Number(quote.amount_paise)+Number(quote.platform_fee_paise),platform_fee_tax_inclusive:true,expires_at:quote.expires_at}:null})
}
