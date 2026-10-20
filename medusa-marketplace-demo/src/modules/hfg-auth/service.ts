import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import type { AuthenticationInput, AuthIdentityProviderService, AuthenticationResponse } from "@medusajs/framework/types"
export async function verifyHfgToken(token: unknown, fetcher = fetch) {
 if(typeof token!=="string" || token.length<20 || token.length>16384 || /\s/.test(token)) throw new Error("Sign in to HFG again")
 const origin = process.env.HFG_USER_ONBOARD_URL
 if(!origin) throw new Error("HFG sign-in is not configured")
 const url = new URL(origin)
 if(url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash) throw new Error("Invalid HFG identity server configuration")
 // The destination is server configuration, never supplied by the customer.
 const response = await fetcher(`${url.origin}/api/users`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000),redirect:"error"})
 if(!response.ok) throw new Error("HFG session is invalid, expired, or unavailable. Sign in again.")
 const {user} = await response.json()
 if(!user || !Number.isSafeInteger(user.id) || user.id<=0 || !user.fid || user.deleted_at) throw new Error("HFG account is not active")
 return {id:String(user.id)}
}
export default class HfgAuthProvider extends AbstractAuthModuleProvider {
 static identifier = "hfg"
 static DISPLAY_NAME = "Hash for Gamers"
 async authenticate(input: AuthenticationInput, identities: AuthIdentityProviderService): Promise<AuthenticationResponse> {
  try {
   const user = await verifyHfgToken(input.body?.token)
   const selector = {entity_id:`hfg:${user.id}`}
   let authIdentity
   try { authIdentity = await identities.retrieve(selector) }
   catch(e) {
    if(e.type!==MedusaError.Types.NOT_FOUND) throw e
    try { authIdentity = await identities.create({...selector,user_metadata:{hfg_user_id:user.id}}) }
    catch { authIdentity = await identities.retrieve(selector) } // Concurrent first sign-in.
   }
   return {success:true,authIdentity}
  } catch { return {success:false,error:"Unable to verify HFG session. Sign in to HFG again or try later."} }
 }
 async register(input: AuthenticationInput, identities: AuthIdentityProviderService) { return this.authenticate(input,identities) }
}
