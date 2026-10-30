import { actor,fail } from '../../../../lib/hash/access'
import { saveCommercial,vendorCommercial,pricePreview } from '../../../../lib/hash/commercial'
import { Modules } from '@medusajs/framework/utils'
export async function GET(req:any,res:any){const a=await actor(req),id=a.superAdmin?String(req.query.vendor_id||''):a.vendor_id;const v=await vendorCommercial(a,id);res.setHeader('Cache-Control','no-store');res.json({...v,...(req.query.product_minor!==undefined?{preview:pricePreview(Number(req.query.product_minor),Number(req.query.delivery_minor||0),v.effective)}:{})})}
export async function POST(req:any,res:any){const a=await actor(req),u=await req.scope.resolve(Modules.USER).retrieveUser(a.id);if(u.metadata?.hash_password_change_required)fail('Change your temporary password first');res.json(await saveCommercial(a,req.body))}
