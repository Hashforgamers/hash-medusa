import { Modules } from '@medusajs/framework/utils'
import { minorUnits,currencyDigits } from './policy'

// Only advertise unconditional one-item offers. Customer, basket, shipping and
// buy/get eligibility must be decided by the real cart, never guessed on a card.
export function cardEligible(p:any,product:any,currency:string,now=Date.now()){
 const m=p.application_method,c=p.campaign
 if(p.status!=='active'||p.type!=='standard'||m?.target_type!=='items'||!['percentage','fixed'].includes(m.type)||!['across','each'].includes(m.allocation))return false
 if(m.currency_code&&m.currency_code!==currency)return false
 if(c?.starts_at&&Date.parse(c.starts_at)>now||c?.ends_at&&Date.parse(c.ends_at)<=now)return false
 if(c?.budget?.limit!=null&&Number(c.budget.used)>=Number(c.budget.limit))return false
 const matches=(rules:any[],values:Record<string,string>)=>rules.every(r=>Object.prototype.hasOwnProperty.call(values,r.attribute)&&['eq','in'].includes(r.operator)&&(r.values||[]).some(v=>String(v.value)===values[r.attribute]))
 return matches(p.rules||[],{currency_code:currency})&&matches(m.target_rules||[],{product_id:product.product_id,variant_id:product.variant_id})
}
export function cardAmounts(original:number,actions:any[],itemId:string,currency:string){
 const originalMinor=minorUnits(original,currency),scale=10**currencyDigits(currency)
 const discountMinor=Math.min(originalMinor,actions.filter(a=>a.action==='addItemAdjustment'&&a.item_id===itemId).reduce((sum,a)=>sum+minorUnits(a.amount,currency),0))
 return {currency_code:currency,original_amount:originalMinor/scale,discount_amount:discountMinor/scale,calculated_amount:(originalMinor-discountMinor)/scale,original_amount_minor:originalMinor,discount_amount_minor:discountMinor,calculated_amount_minor:originalMinor-discountMinor,discount_percent:originalMinor?Math.round(discountMinor/originalMinor*10000)/100:0,quantity:1,is_estimate:true,excludes_platform_fee:true,excludes_delivery:true,tax_calculation:'not_address_specific'}
}
export async function withCatalogOffers(container:any,products:any[],currency:string){
 if(!products.length)return []
 const service=container.resolve(Modules.PROMOTION)
 const all=await service.listPromotions({status:'active'},{take:null,relations:['application_method','application_method.target_rules','application_method.target_rules.values','rules','rules.values','campaign','campaign.budget']})
 // Hash's campaign identifier marks offers created for public storefront use.
 const promotions=all.filter(p=>p.is_automatic||p.campaign?.campaign_identifier?.startsWith('hash-'))
 const output:any[]=new Array(products.length);let cursor=0
 await Promise.all(Array.from({length:Math.min(4,products.length)},async()=>{
  while(cursor<products.length){const index=cursor++,product=products[index],price=product.prices?.find(p=>p.currency_code===currency)
   if(!price){output[index]={...product,pricing:null,offers:[]};continue}
   const eligible=promotions.filter(p=>cardEligible(p,product,currency)),id='preview_'+product.product_id,amount=Number(price.amount)
   const context={currency_code:currency,items:[{id,product_id:product.product_id,variant_id:product.variant_id,quantity:1,unit_price:amount,subtotal:amount,original_total:amount,total:amount,is_discountable:true,adjustments:[]}],shipping_methods:[]}
   const compute=(codes:string[])=>codes.length?service.computeActions(codes,context,{prevent_auto_promotions:true}):Promise.resolve([])
   const automatic=await compute(eligible.filter(p=>p.is_automatic).map(p=>p.code))
   const offers=[]
   for(const p of eligible){const actions=await compute([p.code]),preview=cardAmounts(amount,actions,id,currency);if(!preview.discount_amount_minor)continue;offers.push({id:p.id,code:p.code,automatic:p.is_automatic,requires_code:!p.is_automatic,discount_type:p.application_method.type,value:Number(p.application_method.value),currency_code:currency,discount_amount:preview.discount_amount,price_after_discount:preview.calculated_amount,discount_amount_minor:preview.discount_amount_minor,price_after_discount_minor:preview.calculated_amount_minor,starts_at:p.campaign?.starts_at||null,ends_at:p.campaign?.ends_at||null,preview_quantity:1})}
   output[index]={...product,pricing:cardAmounts(amount,automatic,id,currency),offers}
  }
 }))
 return output
}
