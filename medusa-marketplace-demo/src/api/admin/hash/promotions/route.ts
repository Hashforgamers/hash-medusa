import { Modules } from '@medusajs/framework/utils'
import { createPromotionsWorkflow, updatePromotionsWorkflow } from '@medusajs/medusa/core-flows'
import { z } from 'zod'
import { actor, requireHash, fail } from '../../../../lib/hash/access'
import { db, audit, transaction } from '../../../../lib/hash/db'
import { promotionDefinition, promotionInput } from '../../../../lib/hash/promotions'
const command=z.union([
 z.object({action:z.literal('create'),definition:promotionDefinition}).strict(),
 z.object({action:z.literal('state'),id:z.string().min(1).max(200),status:z.enum(['active','inactive']),updated_at:z.string().datetime()}).strict()
])
export async function GET(req:any,res:any){
 const a=await actor(req);requireHash(a)
 const offset=Math.max(0,Math.floor(Number(req.query.offset)||0))
 const [promotions,count]=await req.scope.resolve(Modules.PROMOTION).listAndCountPromotions({}, {take:100,skip:offset,order:{created_at:'DESC'},relations:['application_method','application_method.target_rules','application_method.target_rules.values','rules','rules.values','campaign','campaign.budget']})
 res.setHeader('Cache-Control','no-store');res.json({promotions,count,offset,limit:100})
}
export async function POST(req:any,res:any){
 const a=await actor(req);requireHash(a)
 const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if(user.metadata?.hash_password_change_required)fail('Change your temporary password before continuing')
 const parsed=command.safeParse(req.body)
 if(!parsed.success)return res.status(400).json({message:parsed.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')})
 const b=parsed.data
 const result=await transaction('hash:promotions',async c=>{
  if(b.action==='create'){
   const [store]=await req.scope.resolve(Modules.STORE).listStores({}, {relations:['supported_currencies']})
   if(!store.supported_currencies.some((x:any)=>x.currency_code===b.definition.currency_code))fail('Choose an enabled store currency')
   if(b.definition.product_ids.length){const {rows}=await db().query('SELECT product_id FROM hash_listing WHERE product_id=ANY($1::text[])',[b.definition.product_ids]);if(new Set(rows.map(x=>x.product_id)).size!==new Set(b.definition.product_ids).size)fail('Choose existing marketplace listings')}
   if(b.definition.ends_at&&Date.parse(b.definition.ends_at)<=Date.now())fail('Choose a future end date')
   const {result}=await createPromotionsWorkflow(req.scope).run({input:{promotionsData:[promotionInput(b.definition)]}})
   await audit(c,a.id,'promotion_created',result[0].id,{code:b.definition.code,definition:b.definition})
   return result[0]
  }
  const p=await req.scope.resolve(Modules.PROMOTION).retrievePromotion(b.id,{relations:['campaign','campaign.budget']})
  if(new Date(p.updated_at).toISOString()!==b.updated_at)fail('Promotion changed. Refresh before updating.')
  if(b.status==='active'){
   if(p.campaign?.ends_at&&new Date(p.campaign.ends_at).getTime()<=Date.now())fail('This campaign has ended. Create a new promotion with new dates.')
   if(p.campaign?.budget?.limit!=null&&Number(p.campaign.budget.used)>=Number(p.campaign.budget.limit))fail('Campaign usage limit reached. Create a new promotion.')
  }
  await updatePromotionsWorkflow(req.scope).run({input:{promotionsData:[{id:b.id,status:b.status as any}]}})
  await audit(c,a.id,'promotion_status_changed',b.id,{status:b.status})
  return {id:b.id,status:b.status}
 })
 res.json({result})
}
