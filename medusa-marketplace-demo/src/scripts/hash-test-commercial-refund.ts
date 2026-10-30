import { Modules } from '@medusajs/framework/utils'
export default async function refundFixture({container}:any){
 if(!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error('Local fixture database only')
 const service=container.resolve(Modules.PAYMENT),id=process.env.HASH_QA_PAYMENT_ID
 const p=await service.retrievePayment(id)
 if(p.provider_id!=='pp_system_default')throw Error('Only the local system test provider may be refunded')
 await service.refundPayment({payment_id:id,amount:500,note:'LOCAL finance QA; no real funds'})
}
