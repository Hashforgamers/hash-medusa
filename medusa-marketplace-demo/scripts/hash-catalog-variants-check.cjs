const fs=require('fs'),assert=require('node:assert/strict'),{Pool}=require('pg');
if(!process.env.DATABASE_URL||!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))throw Error('Local fixture database only');
const db=new Pool({connectionString:process.env.DATABASE_URL});let key,admin,promo;
async function req(path,method='GET',body,token=admin){const r=await fetch('http://localhost:9000'+path,{method,headers:{'content-type':'application/json',...(key?{'x-publishable-api-key':key}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const b=await r.json();assert.equal(r.status,200,`${method} ${path}: ${b.message||r.status}`);return b}
(async()=>{
 admin=(await req('/auth/user/emailpass','POST',JSON.parse(fs.readFileSync('.local/promotion-ui.json')),null)).token;
 key=(await db.query("SELECT token FROM api_key WHERE deleted_at IS NULL AND type='publishable' ORDER BY created_at LIMIT 1")).rows[0].token;
 const state=await req('/admin/hash'),vendor=state.vendors.find(v=>v.name==='Demo Partner'),stamp=Date.now();assert(vendor);

 const cat=state.categories.find(c=>c.handle==='mouse');assert(cat?.specifications.some(d=>d.key==='color'));
 const body={action:'save_product',vendor_id:vendor.id,title:'Variant QA '+stamp,kind:'product',stock:0,category_ids:[cat.id],specifications:{brand:'Logitech'},variants:['Black','White'].map((color,i)=>({sku:'qa-'+stamp+'-'+i,options:{color},price_inr:100+i,stock:4+i}))};
 const created=(await req('/admin/hash','POST',body)).result;
 const approve=()=>req('/admin/hash','POST',{action:'review_product',product_id:created.product_id,approval:'approved'});
 await approve();
 const list=async color=>(await req('/store/hash/products?limit=100&category_id='+cat.id+'&filters='+encodeURIComponent(JSON.stringify({color:[color]})))).products.find(p=>p.product_id===created.product_id);
 let product=await list('White');assert(product);assert(!(await list('Pink')));
 const white=product.variants.find(v=>v.options.color==='White');assert.equal(white.available,5);assert.equal(white.pricing.calculated_amount,101);
 const region=(await db.query("SELECT id FROM region WHERE currency_code='inr' AND deleted_at IS NULL LIMIT 1")).rows[0].id;
 const cart=(await req('/store/carts','POST',{region_id:region,items:[{variant_id:white.id,quantity:1}]},null)).cart;assert.equal(Number(cart.item_total),101);
 for(const r of body.variants)r.id=product.variants.find(v=>v.sku===r.sku).id;
 body.variants.push({sku:'qa-'+stamp+'-pink',options:{color:'Pink'},price_inr:120,stock:2});
 await req('/admin/hash','POST',{...body,product_id:created.product_id});await approve();product=await list('Pink');assert.equal(product.variants.length,3);assert.equal(product.variants.find(v=>v.options.color==='White').id,white.id);
 console.log('PASS category filters, SKU inventory, selected cart price, editing and adding SKUs');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.end());
