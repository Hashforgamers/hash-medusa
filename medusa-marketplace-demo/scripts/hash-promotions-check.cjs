// Local-only HTTP integration. Does not use hosted credentials or payment providers.
const assert=require('node:assert/strict'),fs=require('fs');
const base='http://localhost:9000';let admin,key;const created=[];const suffix=Date.now();
async function req(path,method='GET',body,token=admin,expected=200){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(key?{'x-publishable-api-key':key}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(d)}`);return d}
async function offer(extra={}){const p=(await req('/admin/hash/promotions','POST',{action:'create',definition:{code:'QA'+suffix+'_'+created.length,discount_type:'percentage',value:10,currency_code:'inr',...extra}})).result;created.push(p.id);return p}
async function state(p,status){return req('/admin/hash/promotions','POST',{action:'state',id:p.id,updated_at:p.updated_at,status})}
(async()=>{try{
 // Mint a local test session using this checkout's JWT secret and local DB only.
 require('dotenv').config({quiet:true});
 const db=new (require('pg').Pool)({connectionString:'postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace'});
 const {rows:[u]}=await db.query("SELECT id FROM \"user\" WHERE metadata->>'is_super_admin'='true' AND deleted_at IS NULL LIMIT 1");await db.end();assert(u);
 admin=require('jsonwebtoken').sign({actor_id:u.id,actor_type:'user',auth_identity_id:'local-promotion-check'},process.env.JWT_SECRET||'supersecret',{expiresIn:'1h'});
 const config=await req('/hash-store/config');key=config.publishable_api_key;
 if(!key){const keys=await req('/admin/api-keys');key=keys.api_keys.find(k=>k.type==='publishable').token}
 const data=await req('/admin/hash');const vendor=data.vendors.find(v=>v.status==='active'&&v.payment_mode==='hash_collects');assert(vendor);
 const product=(await req('/admin/hash','POST',{action:'save_product',vendor_id:vendor.id,title:'Promotion QA '+suffix,kind:'service',price_inr:100,stock:20})).result;
 await req('/admin/hash','POST',{action:'review_product',product_id:product.product_id,approval:'approved'});
 const listing=(await req('/admin/hash')).products.find(p=>p.product_id===product.product_id);
 const regions=(await req('/store/regions')).regions,region=regions.find(r=>r.currency_code==='inr');assert(region);
 const email=`promo-${suffix}@example.test`,password='Local-Promotions-Test-123!';let customer=(await req('/auth/customer/emailpass/register','POST',{email,password},null)).token;
 await req('/store/customers','POST',{email},customer);customer=(await req('/auth/customer/emailpass','POST',{email,password},null)).token;
 const cart=(await req('/store/carts','POST',{region_id:region.id,items:[{variant_id:listing.variant_id,quantity:2}],email},customer)).cart;
 const apply=async codes=>(await req(`/store/carts/${cart.id}/promotions`,'POST',{promo_codes:codes},customer)).cart;
 const p=await offer({product_ids:[product.product_id],usage_limit:2});assert.equal(p.status,'draft');assert.equal(Number((await apply([p.code])).discount_total),0);
 await state(p,'active');assert.equal(Number((await apply([p.code])).discount_total),20);
 let updated=(await req('/admin/hash/promotions')).promotions.find(x=>x.id===p.id);await state(updated,'inactive');assert.equal(Number((await apply([p.code])).discount_total),0);
 await req('/admin/hash/promotions','POST',{action:'create',definition:{code:'INVALID'+suffix,discount_type:'percentage',value:10,currency_code:'inr',product_ids:['nonexistent']}},admin,400);
 // Invalid request never created a promotion, so use a distinct valid product scope.
 const other=data.products.find(x=>x.product_id!==product.product_id);assert(other);
 const scoped=await offer({product_ids:[other.product_id]});await state(scoped,'active');assert.equal(Number((await apply([scoped.code])).discount_total),0);
 const fixed=await offer({discount_type:'fixed',value:25.5,product_ids:[product.product_id]});await state(fixed,'active');assert.equal(Number((await apply([fixed.code])).discount_total),25.5);
 const removed=(await req(`/store/carts/${cart.id}/promotions`,'DELETE',{promo_codes:[fixed.code]},customer)).cart;assert.equal(Number(removed.discount_total),0);
 const future=await offer({starts_at:new Date(Date.now()+86400000).toISOString()});await state(future,'active');assert.equal(Number((await apply([future.code])).discount_total),0);
 const automatic=await offer({automatic:true,product_ids:[product.product_id],value:5,usage_limit:1});await state(automatic,'active');assert.equal(Number((await apply([])).discount_total),10);
 // Complete through the local manual provider only; no gateway calls or real charges.
 await req(`/store/carts/${cart.id}`,'POST',{shipping_address:{first_name:'Test',last_name:'Customer',address_1:'1 Test Street',city:'Bengaluru',country_code:'in',postal_code:'560001',phone:'9000000000'}},customer);
 const options=(await req('/store/shipping-options?cart_id='+cart.id,'GET',undefined,customer)).shipping_options;
 const option=options.find(x=>x.provider_id==='hash_delivery_hash_delivery')||options[0];assert(option);
 await req(`/store/carts/${cart.id}/shipping-methods`,'POST',{option_id:option.id},customer);
 const collection=(await req('/store/payment-collections','POST',{cart_id:cart.id},customer)).payment_collection;
 await req(`/store/payment-collections/${collection.id}/payment-sessions`,'POST',{provider_id:'pp_system_default'},customer);
 const completed=await req(`/store/carts/${cart.id}/complete`,'POST',{},customer);assert.equal(completed.type,'order');assert.equal(Number(completed.order.discount_total),10);
 const redeemed=(await req('/admin/hash/promotions')).promotions.find(x=>x.id===automatic.id);assert.equal(Number(redeemed.campaign.budget.used),1);
 const summary=(await req('/admin/hash')).orders.find(x=>x.order_id===completed.order.id);assert(summary);assert.equal(Number(summary.total_paise),Math.round(Number(completed.order.total)*100));

 await req('/admin/hash','POST',{action:'review_product',product_id:product.product_id,approval:'rejected',review_note:'Local promotion test complete'});
 console.log('PASS draft/active/inactive, percentage/fixed amounts, item scope, schedules, automatic discounts removal, usage accounting, order completion and discounted settlement value using real Medusa workflows.');
 }finally{for(const id of created)await req('/admin/promotions/'+id,'DELETE').catch(()=>{});}
})().catch(e=>{console.error(e.message);process.exitCode=1});
