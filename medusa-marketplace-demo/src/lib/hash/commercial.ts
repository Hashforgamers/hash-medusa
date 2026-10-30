import { z } from 'zod'
import { db, transaction, audit } from './db'
import { fail, own, requireHash } from './access'
export const commercialSchema=z.object({
 vendor_id:z.string().min(1), revision:z.number().int().nonnegative(),
 pilot_start:z.string().datetime(), pilot_days:z.number().int().min(1).max(365),
 pilot_commission_bps:z.number().int().min(0).max(10000),
 platform_fee_minor:z.number().int().min(0).max(100000),
 platform_tax_bps:z.number().int().min(0).max(10000),
 regular_commission_bps:z.number().int().min(0).max(10000).nullable(),
 category_rates:z.record(z.number().int().min(0).max(10000)).default({}),
 agreement_reference:z.string().trim().max(500), enabled:z.boolean(),
}).superRefine((b,c)=>{if(b.enabled&&!b.agreement_reference)c.addIssue({code:'custom',path:['agreement_reference'],message:'Record the agreed commercial terms before activation'})})
export function commercialTerms(v:any,at=new Date()){
 const p=v.commercial_terms
 if(!p?.enabled)return {version:0,commission_bps:v.commission_bps,platform_fee_minor:0,platform_tax_bps:0,gateway_payer:'hash',phase:'existing',category_rates:{}}
 const start=new Date(p.pilot_start),end=new Date(start.getTime()+p.pilot_days*86400000),ended=at>=end,started=at>=start
 return {version:v.commercial_revision,commission_bps:!started?v.commission_bps:ended?(p.regular_commission_bps??p.pilot_commission_bps):p.pilot_commission_bps,
 platform_fee_minor:started?p.platform_fee_minor:0,platform_tax_bps:p.platform_tax_bps,gateway_payer:'hash',
 phase:!started?'scheduled':ended?(p.regular_commission_bps===null?'pilot_expired_review_required':'regular'):'pilot',
 pilot_start:start.toISOString(),pilot_end:end.toISOString(),category_rates:ended?p.category_rates:{},agreement_reference:p.agreement_reference}
}
export function pricePreview(product:number,shipping:number,terms:any){
 if(!Number.isSafeInteger(product)||product<0||!Number.isSafeInteger(shipping)||shipping<0)throw Error('Invalid price')
 const fee=terms.platform_fee_minor,commission=Math.floor(product*terms.commission_bps/10000),total=product+shipping+fee
 const gatewayBase=Math.round(total*200/10000),gatewayTax=Math.round(gatewayBase*1800/10000)
 return {product_minor:product,customer_delivery_minor:shipping,platform_fee_minor:fee,platform_fee_tax_minor:Math.round(fee*terms.platform_tax_bps/(10000+terms.platform_tax_bps)),customer_total_minor:total,commission_minor:commission,seller_before_courier_minor:product+shipping-commission,gateway_estimate_minor:gatewayBase+gatewayTax,hash_contribution_estimate_minor:commission+fee-gatewayBase-gatewayTax}
}
export async function saveCommercial(a:any,input:any){
 requireHash(a);const b=commercialSchema.parse(input)
 return transaction('vendor:'+b.vendor_id,async c=>{
  const {rows:[v]}=await c.query('SELECT * FROM hash_vendor WHERE id=$1 FOR UPDATE',[b.vendor_id]);if(!v)fail('Partner not found');if(v.commercial_revision!==b.revision)fail('Terms changed; refresh before saving')
  const {vendor_id,revision,...terms}=b
  await c.query('UPDATE hash_vendor SET commercial_terms=$2,commercial_revision=commercial_revision+1 WHERE id=$1',[vendor_id,JSON.stringify(terms)])
  await audit(c,a.id,'commercial_terms_updated',vendor_id,{revision:revision+1,terms});return {revision:revision+1}
 })
}
export async function vendorCommercial(a:any,vendorId:string){own(a,vendorId);const {rows:[v]}=await db().query('SELECT id,name,commission_bps,commercial_terms,commercial_revision FROM hash_vendor WHERE id=$1',[vendorId]);if(!v)fail('Partner not found');return {...v,effective:commercialTerms(v)}}
