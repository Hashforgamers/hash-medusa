import { randomUUID, randomBytes } from "crypto"
import { Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, updateProductsWorkflow, updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { db, transaction, audit } from "./db"
import { storedBank } from "./vendor-profile"
import { currencyDigits } from "./policy"
import { fail, own, requireHash } from "./access"

export async function createAccount(container: any, email: string, password: string, metadata: any = {}) {
  const auth = container.resolve(Modules.AUTH), users = container.resolve(Modules.USER)
  const existing = await users.listUsers({ email })
  if (existing.length) fail("An account with this email already exists")
  const result = await auth.register("emailpass",{ body:{ email,password } })
  if (!result.success || !result.authIdentity) fail(result.error || "Unable to register account")
  let user: any
  try {
    user = await users.createUsers({ email, metadata })
    await auth.updateAuthIdentities({ id:result.authIdentity.id, app_metadata:{ ...result.authIdentity.app_metadata,user_id:user.id } })
    return user
  } catch(e) {
    if (user) await users.deleteUsers(user.id)
    await auth.deleteAuthIdentities(result.authIdentity.id)
    throw e
  }
}
export async function onboard(container: any, a: any, b: any) {
  requireHash(a)
  const id = `hv_${randomUUID()}`, password = randomBytes(18).toString("base64url")
  return transaction(`email:${b.email}`,async c => {
    await c.query("INSERT INTO hash_vendor(id,name,commission_bps,payment_mode,payout_details,business_details,bank_details) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,b.name,b.commission_bps,b.payment_mode,b.payout_details,JSON.stringify(b.business_details||{}),JSON.stringify(b.bank_details?storedBank(b.bank_details):{})])
    const user = await createAccount(container,b.email,password,{ hash_password_change_required:true })
    try {
      await c.query("INSERT INTO hash_member(user_id,vendor_id,role) VALUES($1,$2,'owner')",[user.id,id])
      await audit(c,a.id,"vendor_created",id,{ owner:user.id,payment_mode:b.payment_mode,commission_bps:b.commission_bps })
    } catch (e) { await container.resolve(Modules.USER).deleteUsers(user.id); throw e }
    return { vendor_id:id,email:b.email,temporary_password:password,portal:"/hash-portal" }
  })
}
export async function addMember(container: any,a: any,b: any) {
  own(a,b.vendor_id)
  if (!a.superAdmin && a.role !== "owner") fail("Only the company owner can add staff")
  const password = randomBytes(18).toString("base64url")
  return transaction(`email:${b.email}`, async c => {
    const user = await createAccount(container,b.email,password,{ hash_password_change_required:true })
    await c.query("INSERT INTO hash_member(user_id,vendor_id,role) VALUES($1,$2,'staff')",[user.id,b.vendor_id])
    await audit(c,a.id,"staff_created",user.id,{vendor_id:b.vendor_id})
    return { email:b.email,temporary_password:password,portal:"/hash-portal" }
  })
}
export async function saveProduct(container: any,a: any,b: any) {
  own(a,b.vendor_id)
  const { rows:[vendor] } = await db().query("SELECT * FROM hash_vendor WHERE id=$1",[b.vendor_id])
  if (!vendor || vendor.status !== "active") fail("Vendor is not active")
  const [configuredStore] = await container.resolve(Modules.STORE).listStores({}, {relations:["supported_currencies"]})
  const prices = b.prices || [{currency_code:"inr",amount:b.price_inr}]
  if(!prices.length || new Set(prices.map(p=>p.currency_code)).size!==prices.length) fail("Provide one price per currency")
  for(const p of prices){
    if(!configuredStore.supported_currencies.some(c=>c.currency_code===p.currency_code))fail("Enable the listing currency in Operations settings first")
    const scale=10**currencyDigits(p.currency_code)
    if(Math.abs(p.amount*scale-Math.round(p.amount*scale))>0.000001)fail("Price has too many decimal places for its currency")
  }
  return transaction(`product:${b.product_id || b.vendor_id}`, async c => {
    let productId = b.product_id
    const [store] = await container.resolve(Modules.STORE).listStores()
    const [profile] = await container.resolve(Modules.FULFILLMENT).listShippingProfiles({type:"default"})
    if (!store?.default_sales_channel_id || !profile) fail("Run Hash setup before creating listings")
    if (productId) {
      const { rows:[listing] } = await c.query("SELECT * FROM hash_listing WHERE product_id=$1",[productId])
      if (!listing || listing.vendor_id !== b.vendor_id) fail("Product not found")
      own(a,listing.vendor_id)
      // Unpublish before editing. A failed edit stays safely unpublished and pending.
      await container.resolve(Modules.PRODUCT).updateProducts(productId,{status:"draft"})
      await c.query("UPDATE hash_listing SET approval='pending',review_note='',updated_at=now() WHERE product_id=$1",[productId])
      await updateProductsWorkflow(container).run({input:{selector:{id:productId},update:{title:b.title,description:b.description,thumbnail:b.thumbnail || null,status:"draft"}}})
      const {data:[p]} = await container.resolve("query").graph({entity:"product",fields:["id","variants.id"],filters:{id:productId}})
      await updateProductVariantsWorkflow(container).run({input:{product_variants:[{id:p.variants[0].id,prices}]}})
    } else {
      const {result} = await createProductsWorkflow(container).run({input:{products:[{
        title:b.title,description:b.description,thumbnail:b.thumbnail || undefined,status:"draft",shipping_profile_id:profile.id,
        handle:`${b.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,60)}-${randomBytes(4).toString("hex")}`,
        options:[{title:"Option",values:["Standard"]}],sales_channels:[{id:store.default_sales_channel_id}],
        variants:[{title:"Standard",options:{Option:"Standard"},manage_inventory:true,allow_backorder:false,prices}]
      }]}})
      productId = result[0].id
      await c.query("INSERT INTO hash_listing(product_id,vendor_id,kind) VALUES($1,$2,$3)",[productId,b.vendor_id,b.kind])
    }
    await setStock(container,productId,b.stock)
    await c.query("UPDATE hash_listing SET kind=$2 WHERE product_id=$1",[productId,b.kind])
    await audit(c,a.id,"listing_submitted",productId,{vendor_id:b.vendor_id})
    return { product_id:productId,approval:"pending" }
  })
}
export async function setStock(container: any,productId: string,stock: number) {
  const {data:[product]} = await container.resolve("query").graph({entity:"product",fields:["id","variants.inventory_items.inventory_item_id"],filters:{id:productId}})
  const item = product?.variants?.[0]?.inventory_items?.[0]?.inventory_item_id
  const [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({name:"Hash Fulfilment"})
  if (!item || !location) fail("Inventory configuration is missing")
  const inventory = container.resolve(Modules.INVENTORY)
  const [level] = await inventory.listInventoryLevels({inventory_item_id:item,location_id:location.id})
  if (level && stock < Number(level.reserved_quantity)) fail("Stock cannot be lower than reserved quantity")
  if (level) await inventory.updateInventoryLevels({inventory_item_id:item,location_id:location.id,stocked_quantity:stock})
  else await inventory.createInventoryLevels({inventory_item_id:item,location_id:location.id,stocked_quantity:stock})
}
export async function reviewProduct(container: any,a: any,b: any) {
  requireHash(a)
  return transaction(`product:${b.product_id}`,async c => {
    const {rows:[listing]} = await c.query("SELECT l.*,v.status FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE product_id=$1",[b.product_id])
    if (!listing) fail("Product not found")
    if (b.approval === "approved" && listing.status !== "active") fail("Activate the vendor first")
    // Draft first closes access even if publishing or the SQL transaction fails.
    await container.resolve(Modules.PRODUCT).updateProducts(b.product_id,{status:"draft"})
    await c.query("UPDATE hash_listing SET approval=$2,review_note=$3,updated_at=now() WHERE product_id=$1",[b.product_id,b.approval,b.review_note])
    if (b.approval === "approved") await container.resolve(Modules.PRODUCT).updateProducts(b.product_id,{status:"published"})
    await audit(c,a.id,"listing_reviewed",b.product_id,{approval:b.approval,note:b.review_note})
    return {product_id:b.product_id,approval:b.approval}
  })
}
export async function catalog(container: any, vendorId?: string, publicOnly=false) {
  const {rows} = await db().query(`SELECT l.*,v.name AS vendor_name FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id
    WHERE ($1::text IS NULL OR l.vendor_id=$1) AND (NOT $2 OR (l.approval='approved' AND v.status='active')) ORDER BY l.updated_at DESC`,[vendorId || null,publicOnly])
  if (!rows.length) return []
  const {data} = await container.resolve("query").graph({entity:"product",fields:["id","title","description","thumbnail","status","variants.id","variants.prices.*","variants.inventory_items.inventory.location_levels.*"],filters:{id:rows.map(r=>r.product_id)}})
  return rows.flatMap(r => {
    const p = data.find((p: any)=>p.id===r.product_id)
    if (!p || (publicOnly && p.status !== "published")) return []
    const variant = p.variants[0],levels = variant?.inventory_items?.flatMap((i: any)=>i.inventory?.location_levels || []) || []
    return [{...r,title:p.title,description:p.description,thumbnail:p.thumbnail,status:p.status,variant_id:variant?.id,
      prices:(variant?.prices||[]).filter((p:any)=>!p.price_list_id&&!p.min_quantity&&!p.max_quantity).map((p:any)=>({currency_code:p.currency_code,amount:p.amount})),
      price_inr:variant?.prices?.find((p:any)=>p.currency_code==="inr")?.amount,
      stock:levels.reduce((n:number,l:any)=>n+Number(l.stocked_quantity || 0),0),
      available:levels.reduce((n:number,l:any)=>n+Number(l.stocked_quantity || 0)-Number(l.reserved_quantity || 0),0)}]
  })
}
export async function validateItems(container: any,items: any[],currency?: string) {
  if(currency){
    const [store]=await container.resolve(Modules.STORE).listStores({}, {relations:["supported_currencies"]})
    if(!store.supported_currencies.some(c=>c.currency_code===currency))fail("This currency is not enabled for Hash checkout")
  }
  if (!items.length) return
  const variantIds = [...new Set(items.map(i=>i.variant_id).filter(Boolean))]
  if (items.some(i=>!i.variant_id)) fail("Every item must reference an approved variant")
  const {data:variants} = await container.resolve("query").graph({entity:"product_variant",fields:["id","product_id","product.status","prices.*"],filters:{id:variantIds}})
  if(currency&&variants.some((v:any)=>!v.prices?.some((p:any)=>p.currency_code===currency&&!p.price_list_id)))fail("Every item needs a price in the selected currency")
  if (variants.length !== variantIds.length) fail("Unknown product variant")
  const ids = [...new Set(variants.map((v:any)=>v.product_id))]
  const {rows} = await db().query(`SELECT l.*,v.status,v.payment_mode FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE product_id=ANY($1::text[])`,[ids])
  if (rows.length !== ids.length || rows.some(r=>r.approval!=="approved" || r.status!=="active") || variants.some((v:any)=>v.product.status!=="published")) fail("Only approved products from active vendors can be purchased")
  if (new Set(rows.map(r=>r.vendor_id)).size !== 1) fail("One vendor per checkout. Start a separate cart for another vendor")
  if (rows.some(r=>r.payment_mode==="vendor_direct")) fail("Direct vendor checkout is not enabled until a payment routing provider is configured")
}
