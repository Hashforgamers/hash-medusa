import { ownReviews,saveReview,reviewSubmission } from '../../../../lib/hash/reviews'
export async function GET(req:any,res:any){res.setHeader('Cache-Control','no-store');res.json(await ownReviews(req.auth_context.actor_id,req.query))}
export async function POST(req:any,res:any){const b=reviewSubmission.safeParse(req.body);if(!b.success)return res.status(400).json({message:b.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')});res.setHeader('Cache-Control','no-store');res.json({review:await saveReview(req.scope,req.auth_context.actor_id,b.data)})}
