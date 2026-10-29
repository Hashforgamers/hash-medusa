import { categories } from '../../../../lib/hash/categories'
export async function GET(req:any,res:any){res.setHeader('Cache-Control','no-store');res.json({categories:await categories(req.scope)})}
