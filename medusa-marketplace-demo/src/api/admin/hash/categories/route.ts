import { actor, requireHash, fail } from '../../../../lib/hash/access'
import { Modules } from '@medusajs/framework/utils'
import { categories, categoryCommand, saveCategory } from '../../../../lib/hash/categories'
export async function GET(req:any,res:any){const a=await actor(req);res.setHeader('Cache-Control','no-store');res.json({categories:await categories(req.scope,a.superAdmin)})}
export async function POST(req:any,res:any){
 const a=await actor(req);requireHash(a)
 const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if(user.metadata?.hash_password_change_required)fail('Change your temporary password before continuing')
 const parsed=categoryCommand.safeParse(req.body)
 if(!parsed.success)return res.status(400).json({message:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')})
 res.json(await saveCategory(req.scope,a,parsed.data))
}
