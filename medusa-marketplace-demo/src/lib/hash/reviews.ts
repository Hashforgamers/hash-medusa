import { randomUUID } from 'crypto'
import { z } from 'zod'
import { MedusaError } from '@medusajs/framework/utils'
import { db, transaction, audit } from './db'
import { fail, requireHash } from './access'
const id=z.string().trim().min(1).max(200)
export const reviewSubmission=z.object({product_id:id,order_id:id,rating:z.number().int().min(1).max(5),title:z.string().trim().max(120).default(''),body:z.string().trim().min(10).max(3000),revision:z.number().int().positive().optional()}).strict()
export const reviewModeration=z.object({id,revision:z.number().int().positive(),status:z.enum(['approved','rejected']),note:z.string().trim().max(1000).default('')}).strict().refine(b=>b.status!=='rejected'||b.note.length>=5,{path:['note'],message:'Explain the moderation decision (at least 5 characters)'})
export const reviewRevision=z.object({revision:z.number().int().positive()}).strict()
const ownFields='id,product_id,order_id,rating,title,body,status,revision,moderation_note,created_at,updated_at'
export function pagination(q:any){const p=z.object({offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(20)}).safeParse(q);if(!p.success)fail('Use offset >= 0 and limit between 1 and 100',MedusaError.Types.INVALID_DATA);return p.data}
export async function publicReviews(productId:string,q:any){
 const {offset,limit}=pagination(q)
 const visible=await db().query(`SELECT l.product_id FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id JOIN product p ON p.id=l.product_id WHERE l.product_id=$1 AND l.approval='approved' AND v.status='active' AND p.status='published' AND p.deleted_at IS NULL`,[productId])
 if(!visible.rowCount)fail('Product not found',MedusaError.Types.NOT_FOUND)
 const [{rows:reviews},{rows:counts}]=await Promise.all([
  db().query(`SELECT id,rating,title,body,created_at,updated_at FROM hash_product_review WHERE product_id=$1 AND status='approved' ORDER BY created_at DESC,id DESC OFFSET $2 LIMIT $3`,[productId,offset,limit]),
  db().query(`SELECT rating,count(*)::integer AS count FROM hash_product_review WHERE product_id=$1 AND status='approved' GROUP BY rating`,[productId])
 ])
 const breakdown={1:0,2:0,3:0,4:0,5:0};for(const r of counts)breakdown[r.rating]=r.count
 const count=counts.reduce((n,r)=>n+r.count,0),sum=counts.reduce((n,r)=>n+r.rating*r.count,0)
 return {reviews:reviews.map(r=>({...r,author:'Verified buyer',verified_purchase:true})),count,offset,limit,rating_summary:{count,average:count?Math.round(sum/count*100)/100:0,breakdown}}
}
export async function ownReviews(customerId:string,q:any){
 const {offset,limit}=pagination(q),parsed=id.nullable().safeParse(q.product_id===undefined?null:q.product_id)
 if(!parsed.success)fail('Provide a valid product_id',MedusaError.Types.INVALID_DATA)
 const productId=parsed.data
 const [{rows:reviews},{rows:[total]}]=await Promise.all([
  db().query(`SELECT ${ownFields} FROM hash_product_review WHERE customer_id=$1 AND ($2::text IS NULL OR product_id=$2) ORDER BY updated_at DESC,id DESC OFFSET $3 LIMIT $4`,[customerId,productId,offset,limit]),
  db().query('SELECT count(*)::integer AS count FROM hash_product_review WHERE customer_id=$1 AND ($2::text IS NULL OR product_id=$2)',[customerId,productId])
 ])
 return {reviews,count:total.count,offset,limit}
}
export async function reviewEligibility(scope:any,customerId:string,orderId:string,productId:string){
 const {data:[native]}=await scope.resolve('query').graph({entity:'order',fields:['id','customer_id','items.product_id'],filters:{id:orderId,customer_id:customerId}})
 if(!native||native.customer_id!==customerId)fail('Order not found',MedusaError.Types.NOT_FOUND)
 if(!native.items?.some((x:any)=>x.product_id===productId))return {eligible:false,reason:'This product was not purchased in this order'}
 const {rows:[order]}=await db().query('SELECT paid_at,completed_at FROM hash_order WHERE order_id=$1 AND customer_id=$2',[orderId,customerId])
 if(!order?.paid_at||!order.completed_at)return {eligible:false,reason:'Reviews open after payment and OTP-confirmed delivery or service completion'}
 return {eligible:true,reason:null}
}
export async function saveReview(scope:any,customerId:string,b:z.infer<typeof reviewSubmission>){
 const eligibility=await reviewEligibility(scope,customerId,b.order_id,b.product_id)
 if(!eligibility.eligible)fail(eligibility.reason)
 return transaction(`review:${customerId}:${b.product_id}`,async c=>{
  const {rows:[prior]}=await c.query('SELECT * FROM hash_product_review WHERE customer_id=$1 AND product_id=$2 FOR UPDATE',[customerId,b.product_id])
  if(prior&&b.revision!==prior.revision)fail('Review changed or already exists. Refresh your reviews before saving.',MedusaError.Types.CONFLICT)
  if(!prior&&b.revision!==undefined)fail('Review not found',MedusaError.Types.NOT_FOUND)
  const reviewId=prior?.id||`hr_${randomUUID()}`
  const {rows:[review]}=prior?await c.query(`UPDATE hash_product_review SET order_id=$2,rating=$3,title=$4,body=$5,status='pending',revision=revision+1,moderation_note='',moderated_by=NULL,moderated_at=NULL,updated_at=now() WHERE id=$1 RETURNING ${ownFields}`,[reviewId,b.order_id,b.rating,b.title,b.body]):await c.query(`INSERT INTO hash_product_review(id,customer_id,product_id,order_id,rating,title,body) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${ownFields}`,[reviewId,customerId,b.product_id,b.order_id,b.rating,b.title,b.body])
  await audit(c,customerId,prior?'customer_review_updated':'customer_review_submitted',reviewId,{product_id:b.product_id,rating:b.rating,revision:review.revision})
  return review
 })
}
export async function withdrawReview(customerId:string,reviewId:string,revision:number){
 return transaction(`review-withdraw:${reviewId}`,async c=>{
  const {rows:[r]}=await c.query('SELECT * FROM hash_product_review WHERE id=$1 AND customer_id=$2 FOR UPDATE',[reviewId,customerId])
  if(!r)fail('Review not found',MedusaError.Types.NOT_FOUND)
  if(r.revision!==revision)fail('Review changed. Refresh before withdrawing.',MedusaError.Types.CONFLICT)
  const {rows:[review]}=await c.query(`UPDATE hash_product_review SET status='withdrawn',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING ${ownFields}`,[reviewId])
  await audit(c,customerId,'customer_review_withdrawn',reviewId,{revision:review.revision});return review
 })
}
export async function operationsReviews(a:any,q:any){
 const {offset,limit}=pagination(q),filter=z.enum(['pending','approved','rejected','withdrawn','all']).safeParse(q.status||'pending')
 if(!filter.success)fail('Invalid review status',MedusaError.Types.INVALID_DATA)
 const status=a.superAdmin?(filter.data==='all'?null:filter.data):'approved',vendor=a.superAdmin?null:a.vendor_id
 const where=`FROM hash_product_review r JOIN hash_listing l ON l.product_id=r.product_id LEFT JOIN product p ON p.id=r.product_id WHERE ($1::text IS NULL OR r.status=$1) AND ($2::text IS NULL OR l.vendor_id=$2)`
 const [{rows:reviews},{rows:[total]}]=await Promise.all([
  db().query(`SELECT r.id,r.product_id,r.rating,r.title,r.body,r.status,r.revision,r.created_at,r.updated_at,l.vendor_id,p.title AS product_title${a.superAdmin?',r.order_id,r.moderation_note':''} ${where} ORDER BY r.updated_at DESC,r.id DESC OFFSET $3 LIMIT $4`,[status,vendor,offset,limit]),
  db().query(`SELECT count(*)::integer AS count ${where}`,[status,vendor])
 ])
 return {reviews,count:total.count,offset,limit}
}
export async function moderateReview(a:any,b:z.infer<typeof reviewModeration>){
 requireHash(a)
 return transaction(`review-moderation:${b.id}`,async c=>{
  const {rows:[r]}=await c.query('SELECT * FROM hash_product_review WHERE id=$1 FOR UPDATE',[b.id])
  if(!r)fail('Review not found',MedusaError.Types.NOT_FOUND)
  if(r.status==='withdrawn')fail('Customer withdrew this review; it cannot be published')
  if(r.revision!==b.revision)fail('Review changed. Refresh and review the current content.',MedusaError.Types.CONFLICT)
  const {rows:[review]}=await c.query(`UPDATE hash_product_review SET status=$2,moderation_note=$3,moderated_by=$4,moderated_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,status,revision`,[b.id,b.status,b.note,a.id])
  await audit(c,a.id,'customer_review_moderated',b.id,{status:b.status,revision:review.revision,note:b.note});return review
 })
}
