const fs=require('fs'),assert=require('node:assert/strict'),{Pool}=require('pg');
const base='http://localhost:9000',f=JSON.parse(fs.readFileSync('.local/hash-test-fixture.json'));
const db=new Pool({connectionString:process.env.DATABASE_URL||'postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace'});let key;
if(process.env.DATABASE_URL&&!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))throw new Error('Use the local fixture database only');
async function req(path,method='GET',body,token,expected=200){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-publishable-api-key':key,...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{d={raw}}assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(d)}`);return d}
(async()=>{
 key=(await db.query("SELECT token FROM api_key WHERE title='HFG Frontend' AND deleted_at IS NULL")).rows[0].token;
 const region=(await db.query("SELECT id FROM region WHERE currency_code='inr' AND deleted_at IS NULL")).rows[0].id;
 const suffix=Date.now(),email=`customer-${suffix}@example.test`,password='Qa-Customer-Strong-2026';
 let {token}=await req('/auth/customer/emailpass/register','POST',{email,password});
 await req('/store/customers','POST',{email,first_name:'QA',last_name:'Customer'},token);
 token=(await req('/auth/customer/emailpass','POST',{email,password})).token;
 const catalog=await req('/store/hash/products');assert(catalog.products.some(p=>p.product_id===f.product.product_id));
 const cart=(await req('/store/carts','POST',{region_id:region,items:[{variant_id:f.product.variant_id,quantity:1}],shipping_address:{first_name:'QA',last_name:'Customer',address_1:'Test Street 1',city:'Bengaluru',country_code:'in',postal_code:'560001'},email},token)).cart;
 const p2=(await req('/admin/hash','POST',{action:'save_product',vendor_id:f.v2.vendor_id,title:'QA Other Vendor '+suffix,kind:'service',price_inr:50,stock:5},f.t2)).result;
 await req('/admin/hash','POST',{action:'review_product',product_id:p2.product_id,approval:'approved'},f.token);
 const other=(await req('/admin/hash','GET',null,f.t2)).products.find(p=>p.product_id===p2.product_id);
 await req(`/store/carts/${cart.id}/line-items`,'POST',{variant_id:other.variant_id,quantity:1},token,400);
 console.log('PASS single-vendor cart guard.');
 const shipping=(await req('/store/shipping-options?cart_id='+cart.id,'GET',null,token)).shipping_options;
 assert(shipping.length,'Shipping option required');
 await req(`/store/carts/${cart.id}/shipping-methods`,'POST',{option_id:shipping[0].id},token);
 const collection=(await req('/store/payment-collections','POST',{cart_id:cart.id},token)).payment_collection;
 await req(`/store/payment-collections/${collection.id}/payment-sessions`,'POST',{provider_id:'pp_system_default'},token);
 const completed=await req(`/store/carts/${cart.id}/complete`,'POST',{},token);assert.equal(completed.type,'order');const order=completed.order;
 const adminOrder=(await req(`/admin/orders/${order.id}?fields=*payment_collections.payments`,'GET',null,f.token)).order;
 const payment=adminOrder.payment_collections[0].payments[0];
 await req(`/admin/payments/${payment.id}/capture`,'POST',{},f.token);
 await req('/admin/hash','POST',{action:'reconcile'},f.token);
 let state=await req('/admin/hash','GET',null,f.token),o=state.orders.find(o=>o.order_id===order.id);assert(o.paid_at);assert(!o.hold_reason);assert.equal(o.total_paise,'100101');
 assert.equal(state.settlements.filter(s=>s.order_id===order.id).length,1);
 let otp=await req(`/store/hash/orders/${order.id}/otp`,'POST',{},token);assert.match(otp.code,/^\d{6}$/);
 await req('/admin/hash','POST',{action:'verify_otp',order_id:order.id,code:otp.code},f.t2,404);
 const bad=otp.code==='000000'?'111111':'000000';
 await req('/admin/hash','POST',{action:'verify_otp',order_id:order.id,code:bad},f.t1,400);
 assert.equal((await db.query('SELECT otp_attempts FROM hash_order WHERE order_id=$1',[order.id])).rows[0].otp_attempts,1);
 for(let i=0;i<4;i++)await req('/admin/hash','POST',{action:'verify_otp',order_id:order.id,code:bad},f.t1,400);
 await req('/admin/hash','POST',{action:'verify_otp',order_id:order.id,code:otp.code},f.t1,400);
 await req(`/store/hash/orders/${order.id}/otp`,'POST',{},token,400);
 // Test fixture only: advance the challenge cooldown, without waiting 15 minutes.
 await db.query("UPDATE hash_order SET otp_locked_until=now()-interval '1 minute',otp_issued_at=now()-interval '2 minutes' WHERE order_id=$1",[order.id]);
 otp=await req(`/store/hash/orders/${order.id}/otp`,'POST',{},token);

 await req('/admin/hash','POST',{action:'verify_otp',order_id:order.id,code:otp.code},f.t1);
 await req('/admin/hash','POST',{action:'verify_otp',order_id:order.id,code:otp.code},f.t1);
 await req('/admin/hash','POST',{action:'reconcile'},f.token);
 state=await req('/admin/hash','GET',null,f.token);let settlements=state.settlements.filter(s=>s.order_id===order.id);assert.equal(settlements.length,2);assert.equal(settlements.reduce((n,s)=>n+Number(s.amount_paise),0),100101);
 await req('/admin/hash','POST',{action:'record_payout',settlement_id:settlements[0].id,reference:'QA-'+suffix},f.token,400);
 // Test fixture only: bring the due date forward to exercise manual transfer recording.
 await db.query("UPDATE hash_settlement SET due_at=now()-interval '1 minute' WHERE order_id=$1",[order.id]);
 await req('/admin/hash','POST',{action:'record_payout',settlement_id:settlements[0].id,reference:'QA-'+suffix},f.t1,400);
 const results=await Promise.all([1,2].map(()=>req('/admin/hash','POST',{action:'record_payout',settlement_id:settlements[0].id,reference:'QA-'+suffix},f.token)));assert.equal(results.length,2);
 assert.equal(Number((await db.query("SELECT count(*) FROM hash_audit WHERE action='manual_payout_recorded' AND entity_id=$1",[settlements[0].id])).rows[0].count),1);
 await req('/admin/hash','POST',{action:'record_payout',settlement_id:settlements[0].id,reference:'QA-duplicate'},f.token,400);
 fs.writeFileSync('.local/hash-order-test.json',JSON.stringify({order_id:order.id,payment_id:payment.id,customer_token:token},null,2),{mode:0o600});
 console.log('PASS checkout, capture reconciliation, customer OTP, failed-attempt persistence, vendor isolation, 50/50 rounding, replay safety, T+1 enforcement, manual payout authorization and concurrent idempotency.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.end());
