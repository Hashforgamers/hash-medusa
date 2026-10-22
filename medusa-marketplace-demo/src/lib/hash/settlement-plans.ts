import { z } from 'zod'
import { db, transaction, audit } from './db'
import { fail, requireHash } from './access'
import { randomUUID } from 'crypto'
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s,'Use a valid calendar date')
export const planSchema=z.object({
 name:z.string().trim().min(2).max(100), capture_bps:z.number().int().min(0).max(10000),
 capture_delay:z.number().int().min(0).max(365), completion_delay:z.number().int().min(0).max(365),
 day_type:z.enum(['business','calendar']), timezone:z.string().max(100).refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true}catch{return false}},'Use an IANA timezone'),
 weekend:z.array(z.number().int().min(0).max(6)).max(6).refine(a=>new Set(a).size===a.length),holidays:z.array(date).max(366),
})
export type Plan = z.infer<typeof planSchema> & {id?:string;revision?:number}
export const legacyPlan:Plan={id:'default',revision:1,name:'Standard 50/50',capture_bps:5000,capture_delay:1,completion_delay:1,day_type:'business',timezone:'Asia/Kolkata',weekend:[0,6],holidays:[]}
export function allocation(net:number,plan:Plan){if(!Number.isSafeInteger(net)||net<0)throw Error('Invalid net amount');const capture=Number(BigInt(net)*BigInt(plan.capture_bps)/10000n);return {payment:capture,completion:net-capture}}
function parts(at:Date,zone:string){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]))}
export function dueDate(at:Date,plan:Plan,milestone:'payment'|'completion'){
 const delay=milestone==='payment'?plan.capture_delay:plan.completion_delay
 if(!delay)return new Date(at)
 const p=parts(at,plan.timezone), d=new Date(Date.UTC(p.year,p.month-1,p.day));let count=0
 while(count<delay){d.setUTCDate(d.getUTCDate()+1);if(plan.day_type==='calendar'||(!plan.weekend.includes(d.getUTCDay())&&!plan.holidays.includes(d.toISOString().slice(0,10))))count++}
 // Convert local midnight to UTC, honoring IANA daylight-saving offsets.
 const target=d.getTime();let value=target
 for(let i=0;i<6;i++){const q=parts(new Date(value),plan.timezone);const delta=target-Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second);if(!delta)return new Date(value);value+=delta}
 // Rare zones skip midnight. Use the first instant on/after the intended local date.
 for(let n=target-36*3600000;n<=target+36*3600000;n+=60000){const q=parts(new Date(n),plan.timezone);if(Date.UTC(q.year,q.month-1,q.day)>=target)return new Date(n)}
 throw Error('Unable to calculate settlement date')
}
export function planSummary(p:Plan){return `${p.capture_bps/100}% after capture · ${100-p.capture_bps/100}% after OTP completion · ${p.capture_delay}/${p.completion_delay} ${p.day_type} days · ${p.timezone}`}
export async function readPlans(c:any=db()){return (await c.query('SELECT id,revision,definition,active,is_default FROM hash_settlement_plan ORDER BY is_default DESC,created_at')).rows.map(p=>({...p.definition,id:p.id,revision:p.revision,active:p.active,is_default:p.is_default}))}
export async function selectedPlan(c:any,vendorId:string):Promise<Plan>{const {rows:[p]}=await c.query(`SELECT p.* FROM hash_settlement_plan p WHERE p.id=COALESCE((SELECT settlement_plan_id FROM hash_vendor WHERE id=$1),(SELECT id FROM hash_settlement_plan WHERE is_default))`,[vendorId]);if(!p)fail('Settlement plan is missing');return {...p.definition,id:p.id,revision:p.revision}}
export async function savePlan(a:any,input:any){requireHash(a);const parsed=planSchema.parse(input.definition);return transaction('hash:finance',async c=>{const id=input.id||`plan_${randomUUID()}`;if(input.id){const r=await c.query('UPDATE hash_settlement_plan SET definition=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING revision',[id,JSON.stringify(parsed),input.revision]);if(!r.rowCount)fail('Plan changed; refresh before saving')}else await c.query('INSERT INTO hash_settlement_plan(id,definition) VALUES($1,$2)',[id,JSON.stringify(parsed)]);await audit(c,a.id,'settlement_plan_saved',id,{name:parsed.name});return {id}})}
export async function setPlanState(a:any,b:any){requireHash(a);return transaction('hash:finance',async c=>{const {rows:[p]}=await c.query('SELECT * FROM hash_settlement_plan WHERE id=$1',[b.id]);if(!p)fail('Plan not found');if(b.action==='default_plan'){if(!p.active)fail('Activate plan first');await c.query('UPDATE hash_settlement_plan SET is_default=false WHERE is_default');await c.query('UPDATE hash_settlement_plan SET is_default=true WHERE id=$1',[b.id])}else{if(p.is_default&&!b.active)fail('Choose a different default first');if(!b.active&&(await c.query('SELECT 1 FROM hash_vendor WHERE settlement_plan_id=$1 LIMIT 1',[b.id])).rows.length)fail('Reassign partners before archiving their plan');await c.query('UPDATE hash_settlement_plan SET active=$2 WHERE id=$1',[b.id,b.active])}await audit(c,a.id,b.action,b.id);return {ok:true}})}
