import { withCatalogOffers } from '../../../../lib/hash/catalog-offers'
import { categories, filterCatalogCategory } from '../../../../lib/hash/categories'
import { db } from "../../../../lib/hash/db"
import { catalog } from "../../../../lib/hash/marketplace"
export async function GET(req:any,res:any) {
 res.setHeader("Cache-Control","no-store")
 const vendor=typeof req.query.vendor_id==="string"?req.query.vendor_id:undefined
 if(req.query.category_id!==undefined&&typeof req.query.category_id!=="string")return res.status(400).json({message:"category_id must be a single category ID"})
 const categoryId=typeof req.query.category_id==="string"?req.query.category_id:undefined
 const currency=typeof req.query.currency_code==='string'?req.query.currency_code.toLowerCase():'inr'
 if(!/^[a-z]{3}$/.test(currency))return res.status(400).json({message:'Use a three-letter currency_code'})
 let products=filterCatalogCategory(await catalog(req.scope,vendor,true),categoryId)
 if(req.query.filters!==undefined){
  if(!categoryId||typeof req.query.filters!=='string'||req.query.filters.length>4000)return res.status(400).json({message:'Use category_id with a JSON filters object'})
  let filters:any
  try{filters=JSON.parse(req.query.filters)}catch{return res.status(400).json({message:'Invalid filter JSON'})}
  const category=(await categories(req.scope)).find(c=>c.id===categoryId)
  if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.entries(filters).some(([key,values])=>!category?.specifications.some(d=>d.key===key&&d.filterable)||!Array.isArray(values)||!values.length||values.some(v=>!['boolean','string','number'].includes(typeof v))))return res.status(400).json({message:'Choose supported category filters and supply an array of values per key'})
  products=products.filter(p=>p.variants.some(v=>Object.entries(filters).every(([key,allowed]:[string,any[]])=>{
    const actual=v.options[key]??p.specifications[key]
    return (Array.isArray(actual)?actual:[actual]).some(x=>allowed.includes(x))
  })))
 }
 const offset=Math.max(0,Number(req.query.offset)||0),limit=Math.min(100,Math.max(1,Number(req.query.limit)||20))
 const selected=products.slice(offset,offset+limit)
 const previews=await withCatalogOffers(req.scope,selected.flatMap(p=>p.variants.map(v=>({product_id:p.product_id,variant_id:v.id,prices:v.prices}))),currency)
 const byVariant=new Map(previews.map(v=>[v.variant_id,v]))
 const page=selected.map(p=>({...p,pricing:byVariant.get(p.variant_id)?.pricing??null,offers:byVariant.get(p.variant_id)?.offers||[],variants:p.variants.map(v=>({...v,pricing:byVariant.get(v.id)?.pricing??null,offers:byVariant.get(v.id)?.offers||[]}))}))
 const {rows:ratings}=await db().query("SELECT product_id,count(*)::integer AS count,round(avg(rating),2)::float AS average FROM hash_product_review WHERE status='approved' AND product_id=ANY($1::text[]) GROUP BY product_id",[page.map(p=>p.product_id)])
 const summaries=new Map(ratings.map(r=>[r.product_id,{count:r.count,average:r.average}]))
 res.json({products:page.map(({review_note,...p})=>({...p,rating_summary:summaries.get(p.product_id)||{count:0,average:0}})),count:products.length,offset,limit,default_currency_code:"inr",currency_code:currency})
}
