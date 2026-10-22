import { z } from 'zod'
import { db } from '../../../../lib/hash/db'
import { enroll,publicEnrollment } from '../../../../lib/hash/razorpay-billing'
const schema=z.object({plan_id:z.string().min(1).max(200),revision:z.number().int().positive(),request_key:z.string().uuid(),accept_terms:z.literal(true)})
export async function POST(req:any,res:any){const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Choose the current plan revision, a UUID request key and explicitly accept the plan terms'});return res.json({subscription:await enroll(req.auth_context.actor_id,parsed.data)})}
export async function GET(req:any,res:any){res.setHeader('Cache-Control','no-store');const {rows}=await db().query('SELECT * FROM hash_subscription WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100',[req.auth_context.actor_id]);res.json({subscriptions:rows.map(publicEnrollment)})}
