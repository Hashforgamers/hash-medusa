// Local-only integration check; never uses the hosted .env database.
process.env.DATABASE_URL='postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace';
process.env.HASH_OTP_SECRET='local-delivery-check-secret-not-production-123456';
require('ts-node/register');
const assert=require('assert'),fs=require('fs'),path=require('path');
const {db,migrate}=require('../src/lib/hash/db');
const {reconcileOrder,issueOtp,verifyOtp}=require('../src/lib/hash/settlements');
const {tracking,updateDelivery,shippingLabel}=require('../src/lib/hash/delivery');
const key='delivery_check_'+Date.now(),vendor=key+'_vendor',customer=key+'_customer',product=key+'_product';
const fixture={id:key,display_id:12345,customer_id:customer,status:'pending',created_at:new Date(),currency_code:'inr',total:499,items:[{product_id:product,title:'Gaming mouse pad',quantity:1,unit_price:499}],payment_collections:[{payments:[{captures:[{amount:499,created_at:new Date()}],refunds:[]}]}],shipping_address:{first_name:'Sample',last_name:'Customer',address_1:'123 Example Road',address_2:'Apartment 42',city:'Bengaluru',province:'Karnataka',postal_code:'560001',country_code:'in',phone:'+91 90000 00000'}};
const container={resolve:name=>({graph:async({filters})=>({data:filters.customer_id&&filters.customer_id!==customer?[]:[fixture]})})};
(async()=>{try{
 await migrate();await migrate();
 await db().query('INSERT INTO hash_vendor(id,name) VALUES($1,$2)',[vendor,'Sample Gaming Store']);
 await db().query("INSERT INTO hash_listing(product_id,vendor_id,kind,approval) VALUES($1,$2,'product','approved')",[product,vendor]);
 await reconcileOrder(container,key);
 const actor={id:'local-test',vendor_id:vendor};
 let t=await tracking(key,customer);assert.equal(t.status,'placed');assert.equal(t.paid,true);
 await assert.rejects(()=>tracking(key,'another-customer'));
 const base={action:'update_delivery',order_id:key,courier:'Manual courier',tracking_number:'SAMPLE123',tracking_url:'https://example.com/track/SAMPLE123',expected_delivery:'2026-11-01',note:'Packed and ready'};
 await assert.rejects(()=>updateDelivery(container,{...actor,vendor_id:'other'}, {...base,revision:0,status:'preparing'}));
 for(const [revision,status] of ['preparing','shipped','out_for_delivery','delivery_attempted','out_for_delivery'].entries())await updateDelivery(container,actor,{...base,revision,status});
 await assert.rejects(()=>updateDelivery(container,actor,{...base,revision:0,status:'preparing'}));
 t=await tracking(key,customer);assert.equal(t.status,'out_for_delivery');assert.equal(t.timeline.length,7);
 const label=shippingLabel({...fixture,paid:true},{name:'Sample Gaming Store',business_details:{address_line1:'45 Example Business Road',city:'Bengaluru',postal_code:'560002',phone:'+91 91111 11111'}},base);
 if(process.env.HASH_LABEL_PREVIEW_PATH)fs.writeFileSync(path.resolve(process.env.HASH_LABEL_PREVIEW_PATH),label);
 const otp=await issueOtp(container,key,customer);await verifyOtp(container,actor,key,otp.code);t=await tracking(key,customer);assert.equal(t.status,'delivered');assert.equal(t.completion_eligible,false);
 await assert.rejects(()=>updateDelivery(container,actor,{...base,revision:5,status:'out_for_delivery'}));
 fixture.status='canceled';fixture.canceled_at=new Date();await reconcileOrder(container,key);t=await tracking(key,customer);assert.equal(t.status,'canceled');
 console.log('Passed: repeatable migration, customer/vendor isolation, stage progression, stale revisions, timeline persistence, OTP-only completion, cancellation, label.');
 }finally{for(const table of ['hash_delivery_event','hash_settlement','hash_order'])await db().query(`DELETE FROM ${table} WHERE order_id=$1`,[key]);await db().query('DELETE FROM hash_audit WHERE entity_id=$1',[key]);await db().query('DELETE FROM hash_listing WHERE product_id=$1',[product]);await db().query('DELETE FROM hash_vendor WHERE id=$1',[vendor]);await db().end()}
})().catch(e=>{console.error(e);process.exitCode=1});
