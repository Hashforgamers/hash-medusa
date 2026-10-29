import { withdrawReview,reviewRevision } from '../../../../../lib/hash/reviews'
export async function DELETE(req:any,res:any){const b=reviewRevision.safeParse(req.body);if(!b.success)return res.status(400).json({message:'Provide the latest review revision'});res.setHeader('Cache-Control','no-store');res.json({review:await withdrawReview(req.auth_context.actor_id,req.params.id,b.data.revision)})}
