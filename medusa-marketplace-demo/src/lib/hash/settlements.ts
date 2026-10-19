import { getPayoutAdapter } from "./payouts"
import { db, transaction, audit } from "./db"
import { paise, split, nextBusinessDay, newOtp, matchesOtp } from "./policy"
import { fail, own } from "./access"

const orderFields = ["id","customer_id","status","currency_code","total","items.*","items.tax_lines.*","items.adjustments.*","shipping_methods.*","shipping_methods.tax_lines.*","shipping_methods.adjustments.*","credit_lines.*", "payment_collections.payments.captures.*", "payment_collections.payments.refunds.*"]
export async function reconcileOrder(container: any, id: string) {
  return transaction(`order:${id}`, async c => {
    const { data } = await container.resolve("query").graph({ entity: "order", fields: orderFields, filters: { id } })
    const order = data[0]
    if (!order) fail("Order not found")
    const ids = [...new Set(order.items.map((i: any) => i.product_id))]
    const { rows: listings } = await c.query(`SELECT l.*, v.commission_bps, v.payment_mode FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE product_id = ANY($1::text[])`, [ids])
    if (!listings.length) return // Legacy orders outside Hash remain untouched.
    if (listings.length !== ids.length || new Set(listings.map(l => l.vendor_id)).size !== 1 || order.currency_code !== "inr") throw new Error(`Invalid marketplace order ${id}: expected one vendor and INR`)
    const total = paise(order.total), vendor = listings[0], amounts = split(total, vendor.commission_bps)
    await c.query(`INSERT INTO hash_order(order_id,vendor_id,customer_id,total_paise,net_paise,commission_bps,payment_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id) DO NOTHING`, [id,vendor.vendor_id,order.customer_id,total,amounts.net,vendor.commission_bps,vendor.payment_mode])
    const payments = (order.payment_collections || []).flatMap((p: any) => p.payments || [])
    const captures = payments.flatMap((p: any) => p.captures || [])
    const captured = captures.reduce((s: number, p: any) => s + paise(p.amount),0)
    const refunded = payments.flatMap((p: any) => p.refunds || []).reduce((s: number,p: any) => s + paise(p.amount),0)
    const { rows: [saved] } = await c.query("SELECT * FROM hash_order WHERE order_id=$1",[id])
    const hold = order.status === "canceled" && !saved.reviewed_canceled ? "Order canceled" : refunded > 0 && refunded !== Number(saved.reviewed_refund_paise) ? "Refund requires Hash review" : total !== Number(saved.reviewed_total_paise ?? saved.total_paise) ? "Order total changed; review required" : captured < total ? "Awaiting full payment capture" : null
    let paidAt = saved.paid_at
    if (!paidAt && captured >= total && total > 0) {
      const times = captures.map((p: any) => new Date(p.created_at).getTime()).filter(Number.isFinite)
      paidAt = new Date(times.length ? Math.max(...times) : Date.now())
    }
    await c.query("UPDATE hash_order SET captured_paise=$2, refunded_paise=$3, hold_reason=$4, paid_at=$5 WHERE order_id=$1",[id,captured,refunded,hold,paidAt])
    if (paidAt && saved.payment_mode === "hash_collects") {
      await schedule(c, saved, "payment", Math.floor(Number(saved.net_paise)/2), paidAt)
      if (saved.completed_at) await schedule(c,saved,"completion",Number(saved.net_paise)-Math.floor(Number(saved.net_paise)/2),saved.completed_at)
    }
  })
}
async function schedule(c: any, order: any, milestone: string, amount: number, at: Date) {
  if (milestone === "completion") {
    const {rows:[first]}=await c.query("SELECT amount_paise FROM hash_settlement WHERE order_id=$1 AND milestone='payment'",[order.order_id])
    amount=Math.max(0,Number(order.net_paise)-Number(first?.amount_paise || 0))
  }
  await c.query(`INSERT INTO hash_settlement(id,order_id,vendor_id,milestone,amount_paise,due_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id,milestone) DO NOTHING`,
    [`${order.order_id}_${milestone}`,order.order_id,order.vendor_id,milestone,amount,nextBusinessDay(new Date(at))])
}
export async function reconcileAll(container: any) {
  let skip = 0
  const failures: string[] = []
  while (true) {
    const { data } = await container.resolve("query").graph({ entity: "order", fields: ["id"], pagination: { take: 100, skip, order: { created_at: "ASC" } } })
    for (const order of data) {
      try { await reconcileOrder(container, order.id) } catch(e) { failures.push(order.id); container.resolve("logger").error(`Hash reconciliation failed for ${order.id}: ${e.message}`) }
    }
    if (data.length < 100) break
    skip += data.length
  }
  if(failures.length) throw new Error(`Hash reconciliation needs review for ${failures.length} order(s): ${failures.join(", ")}`)
}
export async function issueOtp(container: any, orderId: string, customerId: string) {
  // Verify customer ownership before syncing or exposing any order data.
  const { data } = await container.resolve("query").graph({ entity: "order", fields: ["id","customer_id"], filters: { id: orderId, customer_id: customerId } })
  if (!data.length) fail("Order not found")
  await reconcileOrder(container,orderId)
  return transaction(`order:${orderId}`, async c => {
    const { rows: [o] } = await c.query("SELECT * FROM hash_order WHERE order_id=$1 AND customer_id=$2",[orderId,customerId])
    if (!o || !o.paid_at || o.hold_reason || o.reviewed_canceled || o.completed_at) fail("This order is not eligible for completion")
    if (o.otp_locked_until && new Date(o.otp_locked_until).getTime() > Date.now()) fail("OTP locked. Try again after 15 minutes")
    if (o.otp_issued_at && Date.now()-new Date(o.otp_issued_at).getTime() < 60000) fail("Wait 60 seconds before requesting another code")
    const otp = newOtp(orderId), expires = new Date(Date.now()+10*60000)
    await c.query(`UPDATE hash_order SET otp_hash=$2,otp_nonce=$3,otp_expires_at=$4,otp_issued_at=now(),otp_attempts=0,otp_locked_until=NULL WHERE order_id=$1`,[orderId,otp.digest,otp.nonce,expires])
    await audit(c,customerId,"completion_otp_issued",orderId)
    return { code: otp.code, expires_at: expires, instruction: "Share this code with the vendor only after successful delivery or service completion." }
  })
}
export async function verifyOtp(container: any, a: any, orderId: string, code: string) {
  const { rows: [owned] } = await db().query("SELECT vendor_id FROM hash_order WHERE order_id=$1",[orderId])
  if (!owned) fail("Order not found")
  own(a,owned.vendor_id)
  await reconcileOrder(container,orderId)
  const result = await transaction(`order:${orderId}`, async c => {
    const { rows: [o] } = await c.query("SELECT * FROM hash_order WHERE order_id=$1",[orderId])
    own(a,o.vendor_id)
    if (o.completed_at) return { completed_at: o.completed_at }
    if (o.hold_reason || o.reviewed_canceled || !o.paid_at) fail("Order payment must be captured and free of holds")
    if (!o.otp_hash || !o.otp_expires_at || new Date(o.otp_expires_at).getTime() < Date.now() || o.otp_attempts >= 5) fail("Code expired or locked; ask the customer to request another code")
    if (!matchesOtp(orderId,o.otp_nonce,code,o.otp_hash)) {
      await c.query(`UPDATE hash_order SET otp_attempts=otp_attempts+1,otp_locked_until=CASE WHEN otp_attempts>=4 THEN now()+interval '15 minutes' ELSE NULL END WHERE order_id=$1`,[orderId])
      await audit(c,a.id,"completion_otp_failed",orderId)
      return { error: "Invalid completion code" }
    }
    const completed = new Date()
    await c.query("UPDATE hash_order SET completed_at=$2,otp_hash=NULL,otp_nonce=NULL WHERE order_id=$1",[orderId,completed])
    if (o.payment_mode === "hash_collects") await schedule(c,o,"completion",Number(o.net_paise)-Math.floor(Number(o.net_paise)/2),completed)
    await audit(c,a.id,"completion_verified",orderId)
    return { completed_at: completed }
  })
  if ("error" in result) fail(result.error!)
  return result
}

export async function recordPayout(container: any, a: any, id: string, reference: string) {
  const { rows: [row] } = await db().query("SELECT order_id FROM hash_settlement WHERE id=$1",[id])
  if (!row) fail("Settlement not found")
  await reconcileOrder(container,row.order_id)
  return transaction(`order:${row.order_id}`,async c => {
    const { rows: [s] } = await c.query(`SELECT s.*, o.hold_reason,v.status AS vendor_status FROM hash_settlement s JOIN hash_order o ON o.order_id=s.order_id JOIN hash_vendor v ON v.id=s.vendor_id WHERE s.id=$1 FOR UPDATE OF s`,[id])
    if (s.status === "paid") {
      if (s.reference === reference.trim()) return s
      fail("Settlement is already paid")
    }
    if (Number(s.amount_paise) <= 0) fail("Nothing is payable for this settlement")
    if (s.status === "processing" || s.hold_reason || s.vendor_status !== "active" || new Date(s.due_at).getTime() > Date.now()) fail("Settlement is not payable yet or is on hold")
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`payout-reference:${reference.trim()}`])
    const duplicate=await c.query("SELECT id FROM hash_settlement WHERE provider='manual' AND reference=$1 AND id<>$2",[reference.trim(),id])
    if(duplicate.rows.length)fail("This bank reference is already recorded on another settlement")
    const result = await getPayoutAdapter("manual").execute({ settlementId:id, amountPaise:Number(s.amount_paise),currency:"INR",vendorId:s.vendor_id,reference })
    await c.query("UPDATE hash_settlement SET status=$2,reference=$3,paid_at=now(),failure_reason=NULL WHERE id=$1",[id,result.status,result.reference])
    await audit(c,a.id,"manual_payout_recorded",id,{ reference:result.reference,amount_paise:s.amount_paise })
    return { id,...result }
  })
}

export async function reviewAdjustment(container: any,a: any,orderId: string,note: string) {
  await reconcileOrder(container,orderId)
  return transaction(`order:${orderId}`,async c=>{
    const {rows:[o]}=await c.query("SELECT * FROM hash_order WHERE order_id=$1",[orderId])
    if(!o)fail("Order not found")
    const {data:[order]}=await container.resolve("query").graph({entity:"order",fields:orderFields,filters:{id:orderId}})
    if(!Number(o.refunded_paise) && order.status!=="canceled")fail("There is no refund or cancellation to review")
    const {rows:settlements}=await c.query("SELECT * FROM hash_settlement WHERE order_id=$1 FOR UPDATE",[orderId])
    if(settlements.some(s=>s.status==="processing"))fail("Resolve processing transfers before adjusting settlements")
    const gross=order.status==="canceled"?0:Math.max(0,Number(o.total_paise)-Number(o.refunded_paise))
    const {net}=split(gross,o.commission_bps)
    const paid=settlements.filter(s=>s.status==="paid").reduce((n,s)=>n+Number(s.amount_paise),0)
    let remaining=Math.max(0,net-paid)
    for(const milestone of ["payment","completion"]){
      const s=settlements.find(s=>s.milestone===milestone)
      if(!s || s.status==="paid")continue
      const amount=milestone==="payment"?Math.min(remaining,Math.floor(net/2)):remaining
      await c.query("UPDATE hash_settlement SET amount_paise=$2 WHERE id=$1",[s.id,amount])
      remaining-=amount
    }
    await c.query("UPDATE hash_order SET net_paise=$2,reviewed_refund_paise=refunded_paise,reviewed_canceled=$3,recovery_paise=$4,reviewed_total_paise=$5,hold_reason=NULL WHERE order_id=$1",[orderId,net,order.status==="canceled",Math.max(0,paid-net),paise(order.total)])
    await audit(c,a.id,"refund_settlement_adjusted",orderId,{note,net_paise:net,recovery_paise:Math.max(0,paid-net)})
    return {net_paise:net,recovery_paise:Math.max(0,paid-net)}
  })
}
