import { publicReviews } from '../../../../../../lib/hash/reviews'
export async function GET(req:any,res:any){res.setHeader('Cache-Control','no-store');res.json(await publicReviews(req.params.id,req.query))}
