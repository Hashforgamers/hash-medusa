import { ModuleProvider,Modules } from '@medusajs/framework/utils'
import HashDeliveryProvider from './service'
export default ModuleProvider(Modules.FULFILLMENT,{services:[HashDeliveryProvider]})
