import { deliveryCommand, updateDelivery, tracking, shippingLabel } from '../../../lib/hash/delivery'
import { readPlans, selectedPlan, planSummary } from "../../../lib/hash/settlement-plans"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { actor, requireHash, own, fail } from "../../../lib/hash/access"
import { db, audit, transaction } from "../../../lib/hash/db"
import { onboard, addMember, saveProduct, reviewProduct, catalog, setStock } from "../../../lib/hash/marketplace"
import { reconcileOrder, reconcileAll, recordPayout, verifyOtp, reviewAdjustment } from "../../../lib/hash/settlements"
import { bankSchema, businessSchema, storedBank, publicVendor } from "../../../lib/hash/vendor-profile"
const id = z.string().min(1).max(200)
const commands = z.discriminatedUnion("action",[
 deliveryCommand,
 z.object({action:z.literal("shipping_label"),order_id:id}),
 z.object({action:z.literal("onboard"),name:z.string().min(2).max(150),email:z.string().email().transform(s=>s.toLowerCase()),commission_bps:z.number().int().min(0).max(10000).default(0),payment_mode:z.enum(["hash_collects","vendor_direct"]).default("hash_collects"),payout_details:z.string().max(2000).default(""),business_details:businessSchema.optional(),bank_details:bankSchema.optional(),settlement_plan_id:id.nullable().optional()}),
 z.object({action:z.literal("add_member"),vendor_id:id,email:z.string().email().transform(s=>s.toLowerCase())}),
 z.object({action:z.literal("save_product"),vendor_id:id,product_id:id.optional(),title:z.string().min(2).max(200),description:z.string().max(10000).default(""),thumbnail:z.union([z.string().url().refine(s=>s.startsWith("https://"),"Use an HTTPS image URL"),z.literal("")]).default(""),kind:z.enum(["product","service"]),price_inr:z.number().positive().max(10000000).multipleOf(0.01).optional(),prices:z.array(z.object({currency_code:z.string().regex(/^[a-z]{3}$/),amount:z.number().positive().max(10000000)})).min(1).max(30).optional(),stock:z.number().int().min(0).max(10000000)}),
 z.object({action:z.literal("review_product"),product_id:id,approval:z.enum(["approved","rejected"]),review_note:z.string().max(1000).default("")}),
 z.object({action:z.literal("vendor_settings"),vendor_id:id,status:z.enum(["active","suspended"]),commission_bps:z.number().int().min(0).max(10000),payment_mode:z.enum(["hash_collects","vendor_direct"]),payout_details:z.string().max(2000),name:z.string().min(2).max(150).optional(),business_details:businessSchema.optional(),bank_details:bankSchema.optional(),settlement_plan_id:id.nullable().optional()}),
 z.object({action:z.literal("verify_otp"),order_id:id,code:z.string().regex(/^\d{6}$/)}),
 z.object({action:z.literal("record_payout"),settlement_id:id,reference:z.string().trim().min(3).max(200)}),
 z.object({action:z.literal("payout_failed"),settlement_id:id,reason:z.string().min(3).max(1000)}),
 z.object({action:z.literal("reconcile")}),
 z.object({action:z.literal("review_adjustment"),order_id:id,note:z.string().min(3).max(1000)}),
 z.object({action:z.literal("stock"),product_id:id,stock:z.number().int().min(0).max(10000000)}),
 z.object({action:z.literal("change_password"),current_password:z.string().min(1),new_password:z.string().min(12).max(200)}),
 z.object({action:z.literal("remove_member"),user_id:id})
])
export async function GET(req: MedusaRequest,res: MedusaResponse) {
 const a = await actor(req)
 if (typeof req.query.order_id === "string") {
  const {rows:[o]}=await db().query("SELECT vendor_id FROM hash_order WHERE order_id=$1",[req.query.order_id])
  if(!o)fail("Order not found");own(a,o.vendor_id)
  await reconcileOrder(req.scope,req.query.order_id)
  const {data:[order]}=await req.scope.resolve("query").graph({entity:"order",fields:["id","display_id","email","currency_code","created_at","items.title","items.quantity","items.unit_price","shipping_address.*"],filters:{id:req.query.order_id}})
  res.setHeader("Cache-Control","no-store")
  return res.json({order,tracking:await tracking(req.query.order_id)})
 }
 const filter = a.superAdmin ? null : a.vendor_id
 const [{rows:vendors},{rows:orders},{rows:settlements},{rows:members}] = await Promise.all([
  db().query("SELECT * FROM hash_vendor WHERE ($1::text IS NULL OR id=$1) ORDER BY created_at DESC",[filter]),
  db().query(`SELECT order_id,vendor_id,currency_code,total_paise,net_paise,recovery_paise,captured_paise,refunded_paise,payment_mode,settlement_plan,paid_at,completed_at,hold_reason,created_at,shipping_fee_paise,delivery_status,delivery_kind,delivery_revision,canceled_at FROM hash_order WHERE ($1::text IS NULL OR vendor_id=$1) ORDER BY created_at DESC LIMIT 500`,[filter]),
  db().query(`SELECT s.*,o.currency_code,o.hold_reason,CASE WHEN EXISTS(SELECT 1 FROM hash_shipment hs WHERE hs.order_id=o.order_id AND hs.status<>'quoted' AND NOT hs.fee_final) THEN 'Final shipping invoice required' WHEN NOT (v.bank_details ? 'account_number') THEN 'Bank account required' WHEN v.bank_verified_at IS NULL THEN 'Bank verification required' WHEN v.bank_details->>'currency_code' <> o.currency_code THEN 'Bank currency does not match settlement' ELSE NULL END AS payout_block_reason,CASE WHEN s.status='scheduled' AND s.due_at<=now() THEN 'due' ELSE s.status END AS display_status FROM hash_settlement s JOIN hash_order o ON o.order_id=s.order_id JOIN hash_vendor v ON v.id=s.vendor_id WHERE ($1::text IS NULL OR s.vendor_id=$1) ORDER BY s.due_at DESC LIMIT 1000`,[filter]),
  db().query(`SELECT m.*,u.email FROM hash_member m JOIN "user" u ON u.id=m.user_id WHERE ($1::text IS NULL OR vendor_id=$1) AND u.deleted_at IS NULL`,[filter])
 ])
 const user = await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 const products = await catalog(req.scope,filter)
 const [store]=await req.scope.resolve(Modules.STORE).listStores({}, {relations:["supported_currencies"]})
 const countries=a.superAdmin?await req.scope.resolve(Modules.REGION).listCountries({}, {take:500}):[]
 const auditRows = a.superAdmin ? (await db().query("SELECT * FROM hash_audit ORDER BY id DESC LIMIT 100")).rows : []
 res.setHeader("Cache-Control","no-store")
 res.json({actor:{...a,password_change_required:user.metadata?.hash_password_change_required === true},countries:countries.map(c=>({code:c.iso_2,name:c.display_name})),vendors:vendors.map(v=>publicVendor(v,a)),currencies:store.supported_currencies.map(c=>c.currency_code),products,orders,settlements,members,audit:auditRows,plans:await readPlans(),policy:{currency:store.supported_currencies.find(c=>c.is_default)?.currency_code?.toUpperCase(),plan:await selectedPlan(db(),a.vendor_id||""),summary:planSummary(await selectedPlan(db(),a.vendor_id||""))}})
}
export async function POST(req: MedusaRequest,res: MedusaResponse) {
 const a = await actor(req), parsed = commands.safeParse(req.body)
 if (!parsed.success) return res.status(400).json({message:parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")})
 const b = parsed.data
 const user = await req.scope.resolve(Modules.USER).retrieveUser(a.id)
 if (user.metadata?.hash_password_change_required && b.action!=="change_password") fail("Change your temporary password before continuing")
 let result: any
 switch(b.action) {
 case "update_delivery": result=await updateDelivery(req.scope,a,b);break
 case "shipping_label": {
  let {rows:[o]}=await db().query('SELECT * FROM hash_order WHERE order_id=$1',[b.order_id]);if(!o)fail('Order not found');own(a,o.vendor_id)
  await reconcileOrder(req.scope,b.order_id);o=(await db().query('SELECT * FROM hash_order WHERE order_id=$1',[b.order_id])).rows[0]
  const {data:[order]}:any=await req.scope.resolve('query').graph({entity:'order',fields:['id','display_id','items.quantity','shipping_address.*'],filters:{id:b.order_id}})
  if(!order)fail('Order not found');if(o.delivery_kind==='service')fail('Shipping labels are for physical products')
  const {rows:[vendor]}=await db().query('SELECT name,business_details FROM hash_vendor WHERE id=$1',[o.vendor_id])
  result={html:shippingLabel({...order,paid:!!o.paid_at&&!o.hold_reason&&!o.canceled_at},vendor,o.delivery_details),filename:`hash-label-${order.display_id||order.id}.html`}
  await audit(db(),a.id,'shipping_label_generated',b.order_id);res.setHeader('Cache-Control','no-store');break
 }
 case "onboard": result=await onboard(req.scope,a,b); break
 case "add_member": result=await addMember(req.scope,a,b); break
 case "save_product": if(!b.prices&&!b.price_inr)fail("Provide listing prices");result=await saveProduct(req.scope,a,b); break
 case "review_product": result=await reviewProduct(req.scope,a,b); break
 case "verify_otp": result=await verifyOtp(req.scope,a,b.order_id,b.code); break
 case "record_payout": requireHash(a);result=await recordPayout(req.scope,a,b.settlement_id,b.reference);break
 case "review_adjustment": requireHash(a);result=await reviewAdjustment(req.scope,a,b.order_id,b.note);break
 case "reconcile": requireHash(a);await reconcileAll(req.scope);result={ok:true};break
 case "stock": {
  const {rows:[p]}=await db().query("SELECT * FROM hash_listing WHERE product_id=$1",[b.product_id]); if(!p) fail("Product not found");own(a,p.vendor_id)
  await transaction(`product:${b.product_id}`,async c=>{await setStock(req.scope,b.product_id,b.stock);await audit(c,a.id,"stock_updated",b.product_id,{stock:b.stock})});result={ok:true};break
 }
 case "vendor_settings": requireHash(a);await transaction(`vendor:${b.vendor_id}`,async c=>{
  const {rowCount}=await c.query("UPDATE hash_vendor SET status=$2,commission_bps=$3,payment_mode=$4,payout_details=$5 WHERE id=$1",[b.vendor_id,b.status,b.commission_bps,b.payment_mode,b.payout_details]);if(!rowCount)fail("Vendor not found")
  if(b.settlement_plan_id!==undefined){if(b.settlement_plan_id&&!(await c.query('SELECT 1 FROM hash_settlement_plan WHERE id=$1 AND active',[b.settlement_plan_id])).rowCount)fail('Choose an active settlement plan');await c.query('UPDATE hash_vendor SET settlement_plan_id=$2 WHERE id=$1',[b.vendor_id,b.settlement_plan_id])}
  if(b.name)await c.query("UPDATE hash_vendor SET name=$2 WHERE id=$1",[b.vendor_id,b.name])
  if(b.business_details)await c.query("UPDATE hash_vendor SET business_details=$2 WHERE id=$1",[b.vendor_id,JSON.stringify(b.business_details)])
  if(b.bank_details){await c.query("UPDATE hash_vendor SET bank_details=$2,bank_verified_at=NULL,bank_verified_by=NULL,bank_revision=bank_revision+1 WHERE id=$1",[b.vendor_id,JSON.stringify(storedBank(b.bank_details))]);await audit(c,a.id,"bank_details_updated",b.vendor_id)}
  await audit(c,a.id,"vendor_settings_updated",b.vendor_id,{status:b.status,commission_bps:b.commission_bps,payment_mode:b.payment_mode})
 });result={ok:true};break
 case "payout_failed": {
  requireHash(a)
  const {rows:[s]}=await db().query("SELECT * FROM hash_settlement WHERE id=$1",[b.settlement_id]);if(!s)fail("Settlement not found")
  await transaction(`order:${s.order_id}`,async c=>{const {rowCount}=await c.query("UPDATE hash_settlement SET status='failed',failure_reason=$2 WHERE id=$1 AND status IN ('scheduled','failed')",[b.settlement_id,b.reason]);if(!rowCount)fail("Cannot fail a paid or processing settlement");await audit(c,a.id,"payout_failed",b.settlement_id,{reason:b.reason})});result={ok:true};break
 }
 case "remove_member": {
  const {rows:[m]}=await db().query("SELECT * FROM hash_member WHERE user_id=$1",[b.user_id]);if(!m)fail("Member not found");own(a,m.vendor_id)
  if(!a.superAdmin && (a.role!=="owner" || m.role!=="staff"))fail("Only Hash can remove an owner")
  await transaction(`member:${b.user_id}`,async c=>{await c.query("DELETE FROM hash_member WHERE user_id=$1",[b.user_id]);await audit(c,a.id,"member_removed",b.user_id)});result={ok:true};break
 }
 case "change_password": {
  const auth=req.scope.resolve(Modules.AUTH)
  const verified=await auth.authenticate("emailpass",{body:{email:a.email,password:b.current_password}})
  if(!verified.success)fail("Current password is incorrect")
  const updated=await auth.updateProvider("emailpass",{entity_id:a.email,password:b.new_password})
  if(!updated.success)fail("Unable to update password")
  await req.scope.resolve(Modules.USER).updateUsers({id:a.id,metadata:{...user.metadata,hash_password_change_required:false}})
  await audit(db(),a.id,"password_changed",a.id);result={ok:true};break
 }
 }
 res.json({result})
}
