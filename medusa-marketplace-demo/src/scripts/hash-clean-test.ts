import { db, transaction } from "../lib/hash/db"
import { Modules } from "@medusajs/framework/utils"
export default async function cleanup({container}:any) {
 if(new URL(process.env.DATABASE_URL!).hostname!=="127.0.0.1")throw new Error("Local fixtures only")
 const {rows:vendors}=await db().query("SELECT id FROM hash_vendor WHERE name ~ '^QA Vendor [AB] [0-9]{13}$'")
 for(const v of vendors){
  const {rows:products}=await db().query("SELECT product_id FROM hash_listing WHERE vendor_id=$1",[v.id])
  if(products.length)await container.resolve(Modules.PRODUCT).softDeleteProducts(products.map(p=>p.product_id))
  await transaction(`vendor:${v.id}`,async c=>{
   await c.query("DELETE FROM hash_audit WHERE entity_id=$1 OR entity_id IN (SELECT product_id FROM hash_listing WHERE vendor_id=$1) OR entity_id IN (SELECT order_id FROM hash_order WHERE vendor_id=$1) OR entity_id IN (SELECT id FROM hash_settlement WHERE vendor_id=$1) OR actor IN (SELECT user_id FROM hash_member WHERE vendor_id=$1)",[v.id])
   await c.query("DELETE FROM hash_settlement WHERE vendor_id=$1",[v.id])
   await c.query("DELETE FROM hash_order WHERE vendor_id=$1",[v.id])
   await c.query("DELETE FROM hash_listing WHERE vendor_id=$1",[v.id])
   await c.query("DELETE FROM hash_member WHERE vendor_id=$1",[v.id])
   await c.query("DELETE FROM hash_vendor WHERE id=$1",[v.id])
  })
 }
 console.log(`Removed ${vendors.length} QA businesses from Hash; their Medusa products were soft-deleted. Native test orders remain as test history.`)
 await db().end()
}
