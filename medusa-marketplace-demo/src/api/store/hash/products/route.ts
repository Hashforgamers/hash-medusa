import { catalog } from "../../../../lib/hash/marketplace"
export async function GET(req:any,res:any) {
 const vendor=typeof req.query.vendor_id==="string"?req.query.vendor_id:undefined
 const products=await catalog(req.scope,vendor,true)
 const offset=Math.max(0,Number(req.query.offset)||0),limit=Math.min(100,Math.max(1,Number(req.query.limit)||20))
 res.json({products:products.slice(offset,offset+limit).map(({review_note,...p})=>p),count:products.length,offset,limit,currency_code:"inr"})
}
