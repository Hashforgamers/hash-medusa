import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import HfgCafeAuthProvider from "./service"
export default ModuleProvider(Modules.AUTH,{services:[HfgCafeAuthProvider]})
