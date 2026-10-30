import { db } from '../lib/hash/db'
import { executeConnector } from '../lib/hash/payout-connectors'
export default async function autoPayout(container:any){
 if(process.env.HASH_DEMO_MODE==='true')return
 const {rows}=await db().query(`SELECT s.id FROM hash_settlement s JOIN hash_vendor v ON v.id=s.vendor_id JOIN hash_order o ON o.order_id=s.order_id JOIN hash_payout_provider p ON p.id=v.payout_provider_id WHERE v.auto_payout AND v.status='active' AND p.active AND s.status='scheduled' AND s.due_at<=now() AND s.amount_paise>0 AND o.hold_reason IS NULL ORDER BY s.due_at LIMIT 20`)
 for(const s of rows)try{await executeConnector(container,{superAdmin:true,id:'system:auto-payout'},s.id,true)}catch(e){container.resolve('logger').warn(`Automatic payout ${s.id} deferred: ${e.message}`)}
}
export const config={name:'hash-auto-payout',schedule:'*/5 * * * *'}
