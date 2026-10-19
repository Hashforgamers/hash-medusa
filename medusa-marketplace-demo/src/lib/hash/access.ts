import { MedusaError, Modules } from "@medusajs/framework/utils"
import { db } from "./db"
export function fail(message: string, type = MedusaError.Types.NOT_ALLOWED): never { throw new MedusaError(type, message) }
export async function actor(req: any) {
  const id = req.auth_context?.actor_id
  if (!id) fail("Sign in required", MedusaError.Types.UNAUTHORIZED)
  const user = await req.scope.resolve(Modules.USER).retrieveUser(id)
  const superAdmin = user.metadata?.is_super_admin === true
  const { rows } = await db().query(`SELECT m.*, v.status, v.name FROM hash_member m JOIN hash_vendor v ON v.id=m.vendor_id WHERE user_id=$1`, [id])
  if (!superAdmin && (!rows[0] || rows[0].status !== "active")) fail("Your vendor account is not active")
  return { id, email: user.email, superAdmin, ...rows[0] }
}
export function requireHash(a: any) { if (!a.superAdmin) fail("Only Hash administrators can perform this action") }
export function own(a: any, vendorId: string) { if (!a.superAdmin && a.vendor_id !== vendorId) fail("Resource not found", MedusaError.Types.NOT_FOUND) }
