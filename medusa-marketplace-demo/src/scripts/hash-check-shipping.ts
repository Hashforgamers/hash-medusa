// Local Medusa workflow check. No payment session or courier booking is created.
import assert from 'node:assert/strict'
import { createProductsWorkflow,deleteProductsWorkflow,createCartWorkflow,addShippingMethodToCartWorkflow,listShippingOptionsForCartWithPricingWorkflow } from '@medusajs/medusa/core-flows'
import { db } from '../lib/hash/db'
import { validateCheckoutShipping } from '../lib/hash/checkout-shipping'
export default async function check({container}:any){
 if(!process.env.DATABASE_URL?.includes('127.0.0.1:5433/marketplace'))throw Error('Local database required')
 const q=container.resolve('query')
 const [region]=await container.resolve('region').listRegions({currency_code:'inr'}),[channel]=await container.resolve('sales_channel').listSalesChannels({name:'Hash Marketplace'})
 const [profile]=await container.resolve('fulfillment').listShippingProfiles({type:'default'})
 const key='shipping-check-'+Date.now()
 const {result:[product]}=await createProductsWorkflow(container).run({input:{products:[{title:'Local delivery fixture',handle:key,status:'published',shipping_profile_id:profile.id,sales_channels:[{id:channel.id}],options:[{title:'Size',values:['One']}],variants:[{title:'One',manage_inventory:false,options:{Size:'One'},prices:[{currency_code:'inr',amount:100}]}]}]}})
 await db().query("INSERT INTO hash_vendor(id,name,status) VALUES($1,'Local fixture','active')",[key])
 await db().query("INSERT INTO hash_listing(product_id,vendor_id,kind,approval) VALUES($1,$2,'product','approved')",[product.id,key])
 let cart:any
 try{
  const created=await createCartWorkflow(container).run({input:{region_id:region.id,sales_channel_id:channel.id,items:[{variant_id:product.variants[0].id,quantity:1}],shipping_address:{first_name:'Local',last_name:'Test',address_1:'Local fixture only',city:'Bengaluru',country_code:'in',postal_code:'560001',phone:'9000000000'}}});cart=created.result
  const {result:options}=await listShippingOptionsForCartWithPricingWorkflow(container).run({input:{cart_id:cart.id}})
  const option=options.find((o:any)=>o.provider_id==='hash_delivery_hash_delivery');assert(option,'Calculated provider must be selectable');assert.equal(Number(option.amount),0)
  await addShippingMethodToCartWorkflow(container).run({input:{cart_id:cart.id,options:[{id:option.id,data:{}}]}})
  const {data:[saved]}=await q.graph({entity:'cart',fields:['id','currency_code','items.*','shipping_address.*','shipping_methods.*'],filters:{id:cart.id}})
  assert(saved.shipping_methods[0].data.hash_shipping_quote_id);await validateCheckoutShipping(saved)
  console.log('Passed: real Medusa cart, calculated provider lookup/pricing, shipping-method selection and accepted quote validation.')
 }finally{if(cart){await container.resolve('cart').softDeleteCarts([cart.id]);await db().query('DELETE FROM hash_cart_shipping_quote WHERE cart_id=$1',[cart.id]);await db().query('DELETE FROM hash_checkout_shipping_receipt WHERE cart_id=$1',[cart.id])}await db().query('DELETE FROM hash_listing WHERE product_id=$1',[product.id]);await db().query('DELETE FROM hash_vendor WHERE id=$1',[key]);await deleteProductsWorkflow(container).run({input:{ids:[product.id]}});await db().end()}
}
