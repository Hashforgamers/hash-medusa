import { z } from 'zod'
import { reviewEligibility } from '../../../../../lib/hash/reviews'
export async function GET(req:any,res:any){const b=z.object({order_id:z.string().min(1).max(200),product_id:z.string().min(1).max(200)}).safeParse(req.query);if(!b.success)return res.status(400).json({message:'Provide order_id and product_id'});res.setHeader('Cache-Control','no-store');res.json(await reviewEligibility(req.scope,req.auth_context.actor_id,b.data.order_id,b.data.product_id))}
