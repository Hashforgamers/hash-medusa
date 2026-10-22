import { actor, requireHash, fail } from '../../../../lib/hash/access'
import { audit, transaction } from '../../../../lib/hash/db'
import { Modules } from '@medusajs/framework/utils'
import { z } from 'zod'
const command=z.object({vendor_id:z.string().min(1).max(200),action:z.enum(['view','verify']),revision:z.number().int().nonnegative().optional(),note:z.string().trim().min(3).max(500)})
export async function POST(req:any,res:any){
 const a=await actor(req);requireHash(a)
 const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if(user.metadata?.hash_password_change_required)fail('Change your temporary password before continuing')
 const parsed=command.safeParse(req.body)
 if(!parsed.success)return res.status(400).json({message:'Provide a vendor, action and review reason'})
 const b=parsed.data
 const result=await transaction(`vendor:${b.vendor_id}`,async c=>{
  const {rows:[v]}=await c.query('SELECT bank_details,bank_revision FROM hash_vendor WHERE id=$1',[b.vendor_id])
  if(!v?.bank_details?.account_number)fail('Partner bank details are incomplete')
  if(b.action==='verify'&&b.revision!==v.bank_revision)fail('Bank details changed; review the current account again')
  if(b.action==='verify')await c.query('UPDATE hash_vendor SET bank_verified_at=now(),bank_verified_by=$2 WHERE id=$1',[b.vendor_id,a.id])
  await audit(c,a.id,b.action==='view'?'bank_details_viewed':'bank_details_verified',b.vendor_id,{note:b.note})
  return b.action==='view'?{bank_details:v.bank_details,revision:v.bank_revision}:{ok:true}
 })
 res.setHeader('Cache-Control','no-store');res.json(result)
}
