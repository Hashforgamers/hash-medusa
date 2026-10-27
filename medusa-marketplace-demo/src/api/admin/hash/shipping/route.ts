import { Modules } from '@medusajs/framework/utils'
import { actor,fail } from '../../../../lib/hash/access'
import { shippingOverview,shippingAction,shippingCommands } from '../../../../lib/hash/delhivery'
export async function GET(req:any,res:any){const a=await actor(req);res.setHeader('Cache-Control','no-store');res.json(await shippingOverview(a))}
export async function POST(req:any,res:any){const a=await actor(req);const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id);if(user.metadata?.hash_password_change_required)fail('Change your temporary password first');const parsed=shippingCommands.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});res.setHeader('Cache-Control','no-store');res.json({result:await shippingAction(req.scope,a,parsed.data)})}
