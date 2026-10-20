import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import { actor, own, fail } from "../../../../lib/hash/access"
import { db, transaction } from "../../../../lib/hash/db"
import { uploadImage } from "../../../../lib/hash/cloudinary"
export async function POST(req: MedusaRequest, res: MedusaResponse) {
 const a = await actor(req), body = req.body as any
 const user = await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if (user.metadata?.hash_password_change_required) fail("Change your temporary password before continuing")
 const vendorId = body?.vendor_id
 if (typeof vendorId !== "string" || !/^hv_[a-zA-Z0-9_-]+$/.test(vendorId)) fail("Choose a vendor", MedusaError.Types.INVALID_DATA)
 own(a,vendorId)
 const {rows} = await db().query("SELECT id FROM hash_vendor WHERE id=$1 AND status='active'",[vendorId])
 if (!rows.length) fail("Vendor is not active")
 // Persist quota reservations before external I/O, shared across server instances.
 await transaction(`image-upload:${a.id}`,async c=>{
  const {rows:[r]}=await c.query("SELECT count(*)::int AS count FROM hash_audit WHERE actor=$1 AND action='image_upload_requested' AND created_at>now()-interval '1 minute'",[a.id])
  if(r.count>=10) fail("Upload limit reached. Try again in a minute.")
  await c.query("INSERT INTO hash_audit(actor,action,entity_id,detail) VALUES($1,'image_upload_requested',$2,'{}')",[a.id,vendorId])
 })
 const image = await uploadImage(body?.data_url,vendorId)
 res.setHeader("Cache-Control","no-store")
 res.status(201).json({image})
}
