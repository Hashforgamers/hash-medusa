import { ModuleProvider, Modules } from '@medusajs/framework/utils'
import RazorpayProvider from './service'
export default ModuleProvider(Modules.PAYMENT, { services: [RazorpayProvider] })
