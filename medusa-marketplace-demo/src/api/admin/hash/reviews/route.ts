import { Modules } from '@medusajs/framework/utils'
import { actor, requireHash, fail } from '../../../../lib/hash/access'
import { operationsReviews,moderateReview,reviewModeration } from '../../../../lib/hash/reviews'
export async function GET(req:any,res:any){const a=await actor(req);res.setHeader('Cache-Control','no-store');res.json(await operationsReviews(a,req.query))}
export async function POST(req:any,res:any){
 const a=await actor(req);requireHash(a)
 const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if(user.metadata?.hash_password_change_required)fail('Change your temporary password before continuing')
 const b=reviewModeration.safeParse(req.body);if(!b.success)return res.status(400).json({message:b.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')})
 res.setHeader('Cache-Control','no-store');res.json({review:await moderateReview(a,b.data)})
}
