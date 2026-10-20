import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import HfgAuthProvider from "./service"
export default ModuleProvider(Modules.AUTH,{services:[HfgAuthProvider]})
