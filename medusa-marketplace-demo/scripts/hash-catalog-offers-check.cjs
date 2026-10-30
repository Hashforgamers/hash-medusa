const fs=require('fs'),assert=require('node:assert/strict'),{Pool}=require('pg');
if(!process.env.DATABASE_URL||!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))throw Error('Local fixture database only');
const db=new Pool({connectionString:process.env.DATABASE_URL});let key,admin,promo;
async function req(path,method='GET',body,token=admin){const r=await fetch('http://localhost:9000'+path,{method,headers:{'content-type':'application/json',...(key?{'x-publishable-api-key':key}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const b=await r.json();assert.equal(r.status,200,`${method} ${path}: ${b.message||r.status}`);return b}
(async()=>{
 admin=(await req('/auth/user/emailpass','POST',JSON.parse(fs.readFileSync('.local/promotion-ui.json')),null)).token;
 key=(await db.query("SELECT token FROM api_key WHERE deleted_at IS NULL AND type='publishable' ORDER BY created_at LIMIT 1")).rows[0].token;
 const state=await req('/admin/hash'),vendor=state.vendors.find(v=>v.name==='Demo Partner'),stamp=Date.now();assert(vendor);
 const created=(await req('/admin/hash','POST',{action:'save_product',vendor_id:vendor.id,title:'Offer parity QA '+stamp,kind:'service',price_inr:10,stock:5})).result;
 await req('/admin/hash','POST',{action:'review_product',product_id:created.product_id,approval:'approved'});
 const p=(await req('/admin/hash/promotions','POST',{action:'create',definition:{code:'QA-CARD-'+stamp,discount_type:'percentage',value:30,currency_code:'inr',automatic:true,product_ids:[created.product_id]}})).result;promo=p.id;
 await req('/admin/hash/promotions','POST',{action:'state',id:p.id,status:'active',updated_at:p.updated_at});
 const product=(await req('/store/hash/products?limit=100')).products.find(p=>p.product_id===created.product_id);assert(product);assert.equal(product.pricing.original_amount,10);assert.equal(product.pricing.discount_amount,3);assert.equal(product.pricing.calculated_amount,7);assert.equal(product.offers[0].value,30);
 const region=(await db.query("SELECT id FROM region WHERE currency_code='inr' AND deleted_at IS NULL LIMIT 1")).rows[0].id;
 const cart=(await req('/store/carts','POST',{region_id:region,items:[{variant_id:product.variant_id,quantity:1}]},null)).cart;
 assert.equal(Number(cart.discount_total),3);assert.equal(Number(cart.item_total),7);
 console.log('PASS real Medusa automatic promotion: product card INR 10 - INR 3 = INR 7 matches cart');
 const latest=(await req('/admin/hash/promotions')).promotions.find(p=>p.id===promo);await req('/admin/hash/promotions','POST',{action:'state',id:promo,status:'inactive',updated_at:latest.updated_at});
 const inactive=(await req('/store/hash/products?limit=100')).products.find(p=>p.product_id===created.product_id);assert.equal(inactive.pricing.calculated_amount,10);assert.equal(inactive.offers.length,0);console.log('PASS deactivating an offer removes it from product cards');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.end());
