import { Modules } from '@medusajs/framework/utils'
import { createPromotionsWorkflow, updatePromotionsWorkflow } from '@medusajs/medusa/core-flows'
import { z } from 'zod'
import { actor, fail } from '../../../../lib/hash/access'
import { db, audit, transaction } from '../../../../lib/hash/db'
import { promotionDefinition, promotionInput } from '../../../../lib/hash/promotions'
const command=z.union([
 z.object({action:z.literal('create'),definition:promotionDefinition}).strict(),
 z.object({action:z.literal('state'),id:z.string().min(1).max(200),status:z.enum(['active','inactive']),updated_at:z.string().datetime()}).strict()
])
export async function GET(req:any,res:any){
 const a=await actor(req)
 const offset=Math.max(0,Math.floor(Number(req.query.offset)||0))
 const {rows:owners}=await db().query('SELECT promotion_id,vendor_id FROM hash_promotion_owner WHERE ($1::text IS NULL OR vendor_id=$1)',[a.superAdmin?null:a.vendor_id])
 const [promotions,count]=await req.scope.resolve(Modules.PROMOTION).listAndCountPromotions(a.superAdmin?{}:{id:owners.length?owners.map(x=>x.promotion_id):['no-vendor-promotions']}, {take:100,skip:offset,order:{created_at:'DESC'},relations:['application_method','application_method.target_rules','application_method.target_rules.values','rules','rules.values','campaign','campaign.budget']})
 res.setHeader('Cache-Control','no-store');res.json({promotions:promotions.map(p=>({...p,vendor_id:owners.find(x=>x.promotion_id===p.id)?.vendor_id||null})),count,offset,limit:100})
}
export async function POST(req:any,res:any){
 const a=await actor(req)
 const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if(user.metadata?.hash_password_change_required)fail('Change your temporary password before continuing')
 const parsed=command.safeParse(req.body)
 if(!parsed.success)return res.status(400).json({message:parsed.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')})
 const b=parsed.data
 const result=await transaction('hash:promotions',async c=>{
  if(b.action==='create'){
   const [store]=await req.scope.resolve(Modules.STORE).listStores({}, {relations:['supported_currencies']})
   if(!store.supported_currencies.some((x:any)=>x.currency_code===b.definition.currency_code))fail('Choose an enabled store currency')
   if(!a.superAdmin){
    const {rows}=await c.query('SELECT product_id FROM hash_listing WHERE vendor_id=$1',[a.vendor_id])
    const allowed=new Set<string>(rows.map(x=>x.product_id))
    if(b.definition.product_ids.some(x=>!allowed.has(x)))fail('Choose only your own listings')
    if(!b.definition.product_ids.length)b.definition.product_ids=[...allowed]
    if(!b.definition.product_ids.length)fail('Create a listing before adding a promotion')
    if(b.definition.product_ids.length>500)fail('Select up to 500 listings for this offer')
   }
   if(b.definition.product_ids.length){const {rows}=await db().query('SELECT product_id FROM hash_listing WHERE product_id=ANY($1::text[])',[b.definition.product_ids]);if(new Set(rows.map(x=>x.product_id)).size!==new Set(b.definition.product_ids).size)fail('Choose existing marketplace listings')}
   if(b.definition.ends_at&&Date.parse(b.definition.ends_at)<=Date.now())fail('Choose a future end date')
   const {result}=await createPromotionsWorkflow(req.scope).run({input:{promotionsData:[promotionInput(b.definition)]}})
   if(!a.superAdmin)await c.query('INSERT INTO hash_promotion_owner(promotion_id,vendor_id,created_by) VALUES($1,$2,$3)',[result[0].id,a.vendor_id,a.id])
   await audit(c,a.id,'promotion_created',result[0].id,{code:b.definition.code,definition:b.definition})
   return result[0]
  }
  const {rows:[owner]}=await c.query('SELECT vendor_id FROM hash_promotion_owner WHERE promotion_id=$1',[b.id])
  if(!a.superAdmin&&owner?.vendor_id!==a.vendor_id)fail('Promotion not found')
  const p=await req.scope.resolve(Modules.PROMOTION).retrievePromotion(b.id,{relations:['campaign','campaign.budget','application_method','application_method.target_rules','application_method.target_rules.values']})
  if(new Date(p.updated_at).toISOString()!==b.updated_at)fail('Promotion changed. Refresh before updating.')
  if(b.status==='active'){
   if(owner){
    const rules=p.application_method?.target_rules||[]
    const scopeRule=rules.find((r:any)=>r.attribute==='product_id'&&['in','eq'].includes(r.operator))
    const ids=scopeRule?.values?.map((v:any)=>v.value)||[]
    const {rows}=await c.query('SELECT product_id FROM hash_listing WHERE vendor_id=$1 AND product_id=ANY($2::text[])',[owner.vendor_id,ids])
    if(p.type!=='standard'||p.application_method?.target_type!=='items'||!ids.length||new Set(rows.map(x=>x.product_id)).size!==new Set(ids).size)fail('Vendor promotion must target only its owner’s listings. Create a replacement offer.')
   }

   if(p.campaign?.ends_at&&new Date(p.campaign.ends_at).getTime()<=Date.now())fail('This campaign has ended. Create a new promotion with new dates.')
   if(p.campaign?.budget?.limit!=null&&Number(p.campaign.budget.used)>=Number(p.campaign.budget.limit))fail('Campaign usage limit reached. Create a new promotion.')
  }
  await updatePromotionsWorkflow(req.scope).run({input:{promotionsData:[{id:b.id,status:b.status as any}]}})
  await audit(c,a.id,'promotion_status_changed',b.id,{status:b.status})
  return {id:b.id,status:b.status}
 })
 res.json({result})
}
