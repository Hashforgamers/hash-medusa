import { razorpaySettingsSchema,billingSettings,saveBillingSettings,verifyBilling,syncBillingPlan,manageEnrollment,linkEnrollment } from "../../../../lib/hash/razorpay-billing"
import { razorpayPayoutSchema,saveRazorpayPayout } from "../../../../lib/hash/razorpay-payouts"
import { customerPlanSchema,readCustomerPlans,saveCustomerPlan,activateCustomerPlan } from "../../../../lib/hash/customer-plans"
import { z } from 'zod'
import { Modules } from '@medusajs/framework/utils'
import { actor,requireHash,fail } from '../../../../lib/hash/access'
import { db,transaction,audit } from '../../../../lib/hash/db'
import { planSchema,readPlans,savePlan,setPlanState } from '../../../../lib/hash/settlement-plans'
import { connectorSchema,readConnectors,saveConnector,executeConnector,resolveAttempt } from '../../../../lib/hash/payout-connectors'
const id=z.string().min(1).max(200)
const command=z.discriminatedUnion('action',[
 razorpaySettingsSchema.extend({action:z.literal('razorpay_settings')}),
 z.object({action:z.literal('razorpay_verify'),mode:z.enum(['test','live'])}),
 z.object({action:z.literal('sync_customer_plan'),id,revision:z.number().int().positive(),mode:z.enum(['test','live'])}),
 z.object({action:z.literal('manage_subscription'),id,operation:z.enum(['refresh','cancel'])}),
 z.object({action:z.literal('link_subscription'),id,remote_id:z.string().regex(/^sub_[A-Za-z0-9]+$/)}),
 razorpayPayoutSchema.extend({action:z.literal('save_razorpay_payout')}),
 z.object({action:z.literal('save_customer_plan'),id:id.optional(),revision:z.number().int().positive().optional(),definition:customerPlanSchema}),
 z.object({action:z.literal('customer_plan_state'),id,revision:z.number().int().positive(),active:z.boolean()}),
 z.object({action:z.literal('save_plan'),id:id.optional(),revision:z.number().int().positive().optional(),definition:planSchema}),
 z.object({action:z.literal('default_plan'),id}),
 z.object({action:z.literal('plan_state'),id,active:z.boolean()}),
 z.object({action:z.literal('assign'),vendor_id:id,plan_id:id.nullable(),provider_id:id}),
 z.object({action:z.literal('save_connector'),id:id.optional(),revision:z.number().int().positive().optional(),name:z.string().trim().min(2).max(100),config:connectorSchema,secret:z.string().max(4000).optional()}),
 z.object({action:z.literal('connector_state'),id,revision:z.number().int().positive(),active:z.boolean(),confirmed:z.literal(true)}),
 z.object({action:z.literal('execute'),settlement_id:id,confirmed:z.literal(true)}),
 z.object({action:z.literal('resolve'),id,outcome:z.enum(['paid','not_sent']),reference:z.string().trim().min(3).max(200),note:z.string().trim().min(10).max(1000),confirmed:z.literal(true)}),
])
export async function GET(req:any,res:any){const a=await actor(req);requireHash(a);res.setHeader('Cache-Control','no-store');res.json({razorpay:await billingSettings(),subscriptions:(await db().query('SELECT id,customer_id,plan_id,plan_revision,mode,status,remote_id,paid_count,created_at FROM hash_subscription ORDER BY created_at DESC LIMIT 200')).rows,customer_plans:await readCustomerPlans(),plans:await readPlans(),connectors:await readConnectors(),demo_mode:process.env.HASH_DEMO_MODE==='true',attempts:(await db().query('SELECT * FROM hash_payout_attempt ORDER BY created_at DESC LIMIT 200')).rows})}
export async function POST(req:any,res:any){const a=await actor(req);requireHash(a);const user=await req.scope.resolve(Modules.USER).retrieveUser(a.id);if(user.metadata?.hash_password_change_required)fail('Change your temporary password before continuing');const parsed=command.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:parsed.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')});const b=parsed.data;let result:any
 switch(b.action){
 case 'razorpay_settings':result=await saveBillingSettings(a,b);break
 case 'razorpay_verify':result=await verifyBilling(a,b.mode);break
 case 'sync_customer_plan':result=await syncBillingPlan(a,b);break
 case 'manage_subscription':result=await manageEnrollment(a.id,b.id,b.operation,true);break
 case 'link_subscription':result=await linkEnrollment(a,b);break
 case 'save_razorpay_payout':result=await saveRazorpayPayout(a,b);break
 case 'save_customer_plan':result=await saveCustomerPlan(a,b);break
 case 'customer_plan_state':result=await activateCustomerPlan(a,b);break
 case 'save_plan':result=await savePlan(a,b);break
 case 'default_plan':case 'plan_state':result=await setPlanState(a,b);break
 case 'save_connector':result=await saveConnector(a,b);break
 case 'execute':result=await executeConnector(req.scope,a,b.settlement_id);break
 case 'resolve':result=await resolveAttempt(a,b);break
 case 'assign':result=await transaction('hash:finance',async c=>{if(b.plan_id&&!(await c.query('SELECT 1 FROM hash_settlement_plan WHERE id=$1 AND active',[b.plan_id])).rowCount)fail('Choose an active plan');if(b.provider_id!=='manual'&&!(await c.query('SELECT 1 FROM hash_payout_provider WHERE id=$1',[b.provider_id])).rowCount)fail('Connector not found');if(!(await c.query('UPDATE hash_vendor SET settlement_plan_id=$2,payout_provider_id=$3,auto_payout=false WHERE id=$1',[b.vendor_id,b.plan_id,b.provider_id])).rowCount)fail('Partner not found');await audit(c,a.id,'partner_finance_assigned',b.vendor_id,{plan_id:b.plan_id,provider_id:b.provider_id});return {ok:true}});break
 case 'connector_state':result=await transaction('hash:finance',async c=>{if(!(await c.query('UPDATE hash_payout_provider SET active=$2 WHERE id=$1 AND revision=$3 AND secret_encrypted IS NOT NULL',[b.id,b.active,b.revision])).rowCount)fail('Connector changed or has no credential; refresh');await audit(c,a.id,'payout_connector_state',b.id,{active:b.active});return {ok:true}});break
 }
 res.json({result})
}
