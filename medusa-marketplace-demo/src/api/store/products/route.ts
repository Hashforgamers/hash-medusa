import { dirname, join } from "path"
import { db } from "../../../lib/hash/db"
// Reuse Medusa 2.10.1 pricing, tax, pagination and inventory formatting after applying
// ownership filtering at the handler boundary, after built-in query middleware.
const { GET: medusaProducts } = require(join(dirname(require.resolve("@medusajs/medusa")), "api/store/products/route.js"))
export async function GET(req:any,res:any) {
 const {rows}=await db().query("SELECT l.product_id FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE l.approval='approved' AND v.status='active'")
 const allowed=rows.map(r=>r.product_id),requested=req.filterableFields?.id
 req.filterableFields ||= {}
 req.filterableFields.id=requested?allowed.filter(id=>(Array.isArray(requested)?requested:[requested]).includes(id)):allowed
 if(!req.filterableFields.id.length)req.filterableFields.id=["hash_no_products"]
 return medusaProducts(req,res)
}
