import { actor } from '../../../../lib/hash/access'
import { accounts } from '../../../../lib/hash/accounts'
export async function GET(req:any,res:any){res.setHeader('Cache-Control','no-store');res.json(await accounts(await actor(req),req.query))}
import { requireHash,fail } from '../../../../lib/hash/access'
import { transaction,audit } from '../../../../lib/hash/db'
import { z } from 'zod'
import { Modules } from '@medusajs/framework/utils'
export async function POST(req:any,res:any){
 const a=await actor(req);requireHash(a);const u=await req.scope.resolve(Modules.USER).retrieveUser(a.id);if(u.metadata?.hash_password_change_required)fail('Change your temporary password first')
 const b=z.object({vendor_id:z.string().min(1),enabled:z.boolean(),daily_limit_minor:z.number().int().min(0).max(100000000),min_transfer_minor:z.number().int().min(0).max(100000000).default(0),max_transfer_minor:z.number().int().min(0).max(100000000).default(0),confirmed:z.literal(true)}).parse(req.body)
 if(b.max_transfer_minor>0&&b.max_transfer_minor<b.min_transfer_minor)fail('Maximum transfer must be at least the minimum');
 await transaction('vendor:'+b.vendor_id,async c=>{const {rows:[v]}=await c.query('SELECT v.*,p.active AS connector_active FROM hash_vendor v LEFT JOIN hash_payout_provider p ON p.id=v.payout_provider_id WHERE v.id=$1 FOR UPDATE OF v',[b.vendor_id]);if(!v)fail('Partner not found');if(b.enabled&&(!v.connector_active||!v.bank_verified_at||b.daily_limit_minor<=0))fail('Assign an enabled payout connector, verify the bank account and set a positive limit first');await c.query('UPDATE hash_vendor SET auto_payout=$2,auto_payout_daily_minor=$3,auto_payout_min_minor=$4,auto_payout_max_minor=$5 WHERE id=$1',[b.vendor_id,b.enabled,b.daily_limit_minor,b.min_transfer_minor,b.max_transfer_minor]);await audit(c,a.id,'automatic_payout_settings',b.vendor_id,b)});res.json({ok:true})
}
