import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import type { AuthenticationInput, AuthIdentityProviderService, AuthenticationResponse } from "@medusajs/framework/types"

/*
 * Cafes buy on the marketplace from the HFG dashboard Shop. The dashboard
 * sends its own cafe sign-in token; hfg-dashboard confirms which cafe it
 * belongs to (GET /api/vendor/<id>/marketplace/buyer), exactly as the `hfg`
 * provider asks hfg-user-onboard about gamers. Each cafe gets one store
 * customer, separate from any gamer account its owner may have.
 */
export type HfgCafe = { id: string, name: string }

export async function verifyHfgCafeToken(token: unknown, vendorId: unknown, fetcher = fetch): Promise<HfgCafe> {
 if(typeof token!=="string" || token.length<20 || token.length>16384 || /\s/.test(token)) throw new Error("Sign in to the HFG dashboard again")
 const vid = typeof vendorId==="number" ? vendorId : typeof vendorId==="string" && /^\d{1,12}$/.test(vendorId) ? Number(vendorId) : NaN
 if(!Number.isSafeInteger(vid) || vid<=0) throw new Error("Select your cafe first")
 const origin = process.env.HFG_DASHBOARD_URL
 if(!origin) throw new Error("HFG cafe sign-in is not configured")
 const url = new URL(origin)
 if(url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash) throw new Error("Invalid HFG dashboard server configuration")
 // The destination is server configuration; only the numeric cafe id comes from the client.
 const response = await fetcher(`${url.origin}/api/vendor/${vid}/marketplace/buyer`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000),redirect:"error"})
 if(!response.ok) throw new Error("HFG cafe session is invalid, expired, or not allowed to buy. Sign in again.")
 const {buyer} = await response.json()
 if(!buyer || buyer.vendor_id!==vid) throw new Error("HFG cafe account is not active")
 return {id:String(vid), name:typeof buyer.cafe_name==="string" ? buyer.cafe_name.slice(0,120) : ""}
}

export default class HfgCafeAuthProvider extends AbstractAuthModuleProvider {
 static identifier = "hfg-cafe"
 static DISPLAY_NAME = "Hash for Gamers cafe"
 async authenticate(input: AuthenticationInput, identities: AuthIdentityProviderService): Promise<AuthenticationResponse> {
  try {
   const cafe = await verifyHfgCafeToken(input.body?.token, input.body?.vendor_id)
   const selector = {entity_id:`hfg-cafe:${cafe.id}`}
   let authIdentity
   try { authIdentity = await identities.retrieve(selector) }
   catch(e) {
    if(e.type!==MedusaError.Types.NOT_FOUND) throw e
    try { authIdentity = await identities.create({...selector,user_metadata:{hfg_vendor_id:cafe.id,cafe_name:cafe.name}}) }
    catch { authIdentity = await identities.retrieve(selector) } // Concurrent first sign-in.
   }
   return {success:true,authIdentity}
  } catch { return {success:false,error:"Unable to verify the cafe session. Sign in to the HFG dashboard again or try later."} }
 }
 async register(input: AuthenticationInput, identities: AuthIdentityProviderService) { return this.authenticate(input,identities) }
}
