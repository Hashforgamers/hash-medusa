import { db } from "../lib/hash/db"
import { loggerFrom, pingListedProducts, pingProducts } from "../lib/hash/seo-ping"
// Created or edited products are pinged only while buyers can see them. A deleted product is pinged
// if its listing was public, so search engines recrawl and drop the page. Never throws or blocks the event.
export default async function handler({ event, container }: any) {
 const logger=loggerFrom(container),ids=[event.data].flat().map((d:any)=>d?.id).filter(Boolean)
 if(event.name!=="product.deleted")return pingListedProducts(ids,logger)
 db().query("SELECT l.product_id FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE l.product_id=ANY($1::text[]) AND l.approval='approved' AND v.status='active'",[ids])
  .then(({rows})=>pingProducts(rows.map(r=>r.product_id),logger),e=>logger.warn(`SEO ping lookup failed: ${e.message}`)).catch(()=>{})
}
export const config = { event: ["product.created", "product.updated", "product.deleted"] }
