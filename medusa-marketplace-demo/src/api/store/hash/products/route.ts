import { db } from "../../../../lib/hash/db"
import { catalog } from "../../../../lib/hash/marketplace"
export async function GET(req:any,res:any) {
 res.setHeader("Cache-Control","no-store")
 const vendor=typeof req.query.vendor_id==="string"?req.query.vendor_id:undefined
 const products=await catalog(req.scope,vendor,true)
 const offset=Math.max(0,Number(req.query.offset)||0),limit=Math.min(100,Math.max(1,Number(req.query.limit)||20))
 const page=products.slice(offset,offset+limit)
 const {rows:ratings}=await db().query("SELECT product_id,count(*)::integer AS count,round(avg(rating),2)::float AS average FROM hash_product_review WHERE status='approved' AND product_id=ANY($1::text[]) GROUP BY product_id",[page.map(p=>p.product_id)])
 const summaries=new Map(ratings.map(r=>[r.product_id,{count:r.count,average:r.average}]))
 res.json({products:page.map(({review_note,...p})=>({...p,rating_summary:summaries.get(p.product_id)||{count:0,average:0}})),count:products.length,offset,limit,default_currency_code:"inr",currency_code:"inr"})
}
