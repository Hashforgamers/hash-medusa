import { remoteQueryObjectFromString } from '@medusajs/framework/utils'
import { validateCheckoutShipping } from './checkout-shipping'
import { fail } from './access'
/** Validate the native cart before creating a remote payment, not only after capture. */
export async function guardCheckoutPayment(req:any,_res:any,next:any){
 try{
  let id=req.body?.cart_id
  if(!id){const links=await req.scope.resolve('remoteQuery')(remoteQueryObjectFromString({entryPoint:'cart_payment_collection',variables:{filters:{payment_collection_id:req.params.id}},fields:['cart_id']}));id=links[0]?.cart_id}
  if(!id)fail('Cart payment collection not found')
  const {data:[cart]}=await req.scope.resolve('query').graph({entity:'cart',fields:['id','customer_id','currency_code','items.*','shipping_address.*','shipping_methods.*','shipping_methods.adjustments.*'],filters:{id,customer_id:req.auth_context.actor_id}})
  if(!cart)fail('Cart not found');await validateCheckoutShipping(cart);next()
 }catch(e){next(e)}
}
