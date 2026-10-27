import { tracking } from '../../../../../lib/hash/delivery'
import { db } from "../../../../../lib/hash/db"
export async function GET(req:any,res:any) {
 const {rows:[order]}=await db().query("SELECT order_id,paid_at,completed_at,hold_reason,reviewed_canceled FROM hash_order WHERE order_id=$1 AND customer_id=$2",[req.params.id,req.auth_context.actor_id])
 if(!order)return res.status(404).json({message:"Order not found"})
 res.setHeader("Cache-Control","no-store")
 res.json({tracking:await tracking(req.params.id,req.auth_context.actor_id),order:{id:order.order_id,paid:!!order.paid_at,completed_at:order.completed_at,completion_eligible:!!order.paid_at&&!order.completed_at&&!order.hold_reason&&!order.reviewed_canceled}})
}
