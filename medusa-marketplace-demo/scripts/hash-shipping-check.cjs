// Local-only integration check; never uses the hosted .env database.
process.env.DATABASE_URL='postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace';
process.env.HASH_OTP_SECRET='local-delivery-check-secret-not-production-123456';
require('ts-node/register');
const assert=require('assert'),fs=require('fs'),path=require('path');
const {db,migrate}=require('../src/lib/hash/db');
const {reconcileOrder,issueOtp,verifyOtp}=require('../src/lib/hash/settlements');
const {encryptCredential}=require('../src/lib/hash/payout-connectors');
const {shippingAction}=require('../src/lib/hash/delhivery');
const {prepareDispatch,dispatchOrder,resolveDispatch}=require('../src/lib/hash/dispatch');
const {checkoutShippingQuote,validateCheckoutShipping}=require('../src/lib/hash/checkout-shipping');
const {applyShippingFee,assertShippingPayable}=require('../src/lib/hash/shipping-fees');
const {transaction}=require('../src/lib/hash/db');
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
 // Isolated adapter test uses only fake HTTP responses; no real customer data leaves this machine.
 const {rows:priorConfig}=await db().query("SELECT * FROM hash_shipping_config WHERE id='delhivery'");
 const realFetch=global.fetch;let manifests=0,pickupRequests=0,warehouses=0;
 try{
  await db().query("INSERT INTO hash_shipping_config(id,secret_encrypted,active,verified_at) VALUES('delhivery',$1,true,now()) ON CONFLICT(id) DO UPDATE SET secret_encrypted=$1,active=true,verified_at=now()",[encryptCredential('local-test-token')]);
  await db().query('INSERT INTO hash_shipping_pickup(vendor_id,name,pincode) VALUES($1,$2,$3)',[vendor,'Local Test Pickup','560002']);
  global.fetch=async(url,opts)=>{let result;if(url.includes('pin-codes'))result={delivery_codes:[{postal_code:{pin:560001,pre_paid:'Y',remarks:''}}]};else if(url.includes('invoice/charges'))result=[{total_amount:25}];else if(url.includes('clientwarehouse/create')){warehouses++;const p=JSON.parse(opts.body);assert.equal(p.pin,'560002');result={success:true}}else if(url.includes('/fm/request/new/')){pickupRequests++;const p=JSON.parse(opts.body);assert.equal(opts.headers['Content-Type'],'application/json');assert.equal(p.pickup_time,'14:00:00');result={pickup_id:12345}}else if(url.includes('create.json')){manifests++;const body=JSON.parse(new URLSearchParams(opts.body).get('data'));assert(body.pickup_location.name.startsWith('HASH-'));assert(body.shipments[0].add.includes('Edited delivery address'));assert.equal(body.shipments[0].payment_mode,'Prepaid');result={success:true,packages:[{status:'Success',waybill:'1234567890123'}]}}else if(url.includes('packages/json'))result={ShipmentData:[{Shipment:{ReferenceNo:key,AWB:'1234567890123',Status:{Status:'Delivered',StatusType:'DL',StatusDateTime:'2026-10-27T10:00:00'}}}]};else throw Error('Unexpected request');return {ok:true,text:async()=>JSON.stringify(result)}};
  await db().query("UPDATE hash_vendor SET status='active',shipping_payer='customer' WHERE id=$1",[vendor]);
  await db().query("UPDATE hash_listing SET shipping_package=$2 WHERE product_id=$1",[product,{weight_g:500,length_cm:20,width_cm:10,height_cm:5}]);
  const checkout={...fixture,id:key+'_cart',shipping_methods:[]};
  const cq=await checkoutShippingQuote(checkout);assert.equal(Number(cq.amount_paise),2500);
  checkout.shipping_methods=[{amount:25,data:{hash_shipping_quote_id:cq.id}}];
  await validateCheckoutShipping(checkout);
  await db().query("UPDATE hash_cart_shipping_quote SET expires_at=now()-interval '1 minute' WHERE cart_id=$1",[checkout.id]);
  const renewed=await checkoutShippingQuote(checkout);assert.notEqual(renewed.id,cq.id);
  await validateCheckoutShipping(checkout); // Accepted quote survives refresh.
  await assert.rejects(()=>validateCheckoutShipping({...checkout,shipping_address:{...checkout.shipping_address,postal_code:'560003'}}));
  await assert.rejects(()=>validateCheckoutShipping({...checkout,shipping_methods:[{amount:0,data:{hash_shipping_quote_id:cq.id}}]}));
  await db().query("UPDATE hash_vendor SET shipping_payer='seller',shipping_policy_revision=shipping_policy_revision+1 WHERE id=$1",[vendor]);
  const free=await checkoutShippingQuote(checkout);assert.equal(Number(free.amount_paise),0);
  await validateCheckoutShipping(checkout); // Policy changes affect new selections, not accepted amounts.
  await db().query('DELETE FROM hash_cart_shipping_quote WHERE cart_id=$1',[checkout.id]);
  await db().query('DELETE FROM hash_checkout_shipping_receipt WHERE cart_id=$1',[checkout.id]);
  const quote=await shippingAction(container,actor,{action:'quote',order_id:key,parcel:{weight_g:500,length_cm:20,width_cm:10,height_cm:5,mode:'Surface',invoice:'INV-local',ewaybill:''}});assert.equal(Number(quote.quote_paise),2500);
  await assert.rejects(()=>shippingAction(container,{...actor,vendor_id:'other'},{action:'book',order_id:key,revision:quote.revision,confirmed:true}));assert.equal(manifests,0);
  await db().query("UPDATE hash_order SET delivery_status='ready_to_ship' WHERE order_id=$1",[key]);
  const address={first_name:'Sample',last_name:'Customer',address_1:'Edited delivery address',address_2:'',city:'Bengaluru',province:'Karnataka',postal_code:'560001',country_code:'in',phone:'9000000000'};
  const prepared=await prepareDispatch(container,actor,key,{delivery_address:address,pickup_address:{...address,address_1:'Edited pickup address',postal_code:'560002'}});
  const command={order_id:key,revision:prepared.shipment.revision,pickup_date:new Date(Date.now()+86400000).toISOString().slice(0,10),confirmed:true};
  await assert.rejects(()=>dispatchOrder(container,{...actor,vendor_id:'other'},command));
  await dispatchOrder(container,actor,command);assert.equal(manifests,1);assert.equal(warehouses,1);assert.equal(pickupRequests,1);
  const pickupRecord=(await db().query('SELECT pickup_request_id AS id FROM hash_shipment WHERE order_id=$1',[key])).rows[0];
  await db().query("UPDATE hash_pickup_request SET status='review',created_at=now()-interval '3 minutes' WHERE id=$1",[pickupRecord.id]);
  assert.equal((await dispatchOrder(container,actor,command)).status,'pickup_review');assert.equal(pickupRequests,1);
  const resolution={kind:'pickup',id:String(pickupRecord.id),outcome:'confirmed',carrier_id:'12345',note:'Verified in synthetic carrier dashboard',confirmed:true};
  await assert.rejects(()=>resolveDispatch(actor,resolution));
  await resolveDispatch({...actor,superAdmin:true},resolution);
  await Promise.all([dispatchOrder(container,actor,command),dispatchOrder(container,actor,command)]);assert.equal(pickupRequests,1);

  await dispatchOrder(container,actor,command);assert.equal(manifests,1);assert.equal(pickupRequests,1);
  const finalTracking=await tracking(key,customer);assert.equal(finalTracking.delivery_address.address_1,'Edited delivery address');

  await assert.rejects(()=>shippingAction(container,actor,{action:'book',order_id:key,revision:quote.revision,confirmed:true}));assert.equal(manifests,1);
  await shippingAction(container,actor,{action:'sync',order_id:key});const tracked=await tracking(key,customer);assert(tracked.timeline.some(e=>e.status==='carrier_delivered'));assert.notEqual(tracked.status,'delivered');
  await assert.rejects(()=>assertShippingPayable(db(),key));
 }finally{global.fetch=realFetch;await db().query("DELETE FROM hash_shipping_config WHERE id='delhivery'");if(priorConfig.length){const v=priorConfig[0];await db().query('INSERT INTO hash_shipping_config(id,secret_encrypted,active,verified_at,revision) VALUES($1,$2,$3,$4,$5)',[v.id,v.secret_encrypted,v.active,v.verified_at,v.revision])}await db().query('DELETE FROM hash_shipping_pickup WHERE vendor_id=$1',[vendor]);await db().query('DELETE FROM hash_shipment WHERE order_id=$1',[key]);await db().query('DELETE FROM hash_pickup_request WHERE location_name IN (SELECT name FROM hash_dispatch_location WHERE vendor_id=$1)',[vendor]);await db().query('DELETE FROM hash_dispatch_location WHERE vendor_id=$1',[vendor]);await db().query('DELETE FROM hash_delivery_event WHERE order_id=$1',[key]);await db().query("UPDATE hash_order SET delivery_status='placed',delivery_revision=0,delivery_details='{}' WHERE order_id=$1",[key])}

 let t=await tracking(key,customer);assert.equal(t.status,'placed');assert.equal(t.paid,true);
 await assert.rejects(()=>tracking(key,'another-customer'));
 const base={action:'update_delivery',order_id:key,courier:'Manual courier',tracking_number:'SAMPLE123',tracking_url:'https://example.com/track/SAMPLE123',expected_delivery:'2026-11-01',note:'Packed and ready'};
 await assert.rejects(()=>updateDelivery(container,{...actor,vendor_id:'other'}, {...base,revision:0,status:'preparing'}));
 for(const [revision,status] of ['accepted','preparing','ready_to_ship','shipped','out_for_delivery','delivery_attempted','out_for_delivery'].entries())await updateDelivery(container,actor,{...base,revision,status});
 await assert.rejects(()=>updateDelivery(container,actor,{...base,revision:0,status:'preparing'}));
 t=await tracking(key,customer);assert.equal(t.status,'out_for_delivery');assert.equal(t.timeline.length,9);
 const label=shippingLabel({...fixture,paid:true},{name:'Sample Gaming Store',business_details:{address_line1:'45 Example Business Road',city:'Bengaluru',postal_code:'560002',phone:'+91 91111 11111'}},base);
 if(process.env.HASH_LABEL_PREVIEW_PATH)fs.writeFileSync(path.resolve(process.env.HASH_LABEL_PREVIEW_PATH),label);
 const otp=await issueOtp(container,key,customer);await verifyOtp(container,actor,key,otp.code);t=await tracking(key,customer);assert.equal(t.status,'delivered');assert.equal(t.completion_eligible,false);
 await assert.rejects(()=>updateDelivery(container,actor,{...base,revision:5,status:'out_for_delivery'}));
 await db().query("INSERT INTO hash_shipment(order_id,vendor_id,status,waybill,parcel,pickup,quote_paise) VALUES($1,$2,'booked','1234567890123','{}','{}',1000)",[key,vendor]);
 await assert.rejects(()=>assertShippingPayable(db(),key));
 const admin={id:'local-admin',superAdmin:true};
 await shippingAction(container,admin,{action:'invoice',order_id:key,revision:1,amount_paise:1500,reference:'INV-test',note:'Verified invoice test',confirmed:true});
 await assertShippingPayable(db(),key);
 let fees=(await db().query('SELECT SUM(amount_paise) AS n FROM hash_settlement WHERE order_id=$1',[key])).rows[0];assert.equal(Number(fees.n),49900-1500);
 await reconcileOrder(container,key);fees=(await db().query('SELECT SUM(amount_paise) AS n FROM hash_settlement WHERE order_id=$1',[key])).rows[0];assert.equal(Number(fees.n),48400);
 await db().query("UPDATE hash_settlement SET status='paid' WHERE order_id=$1 AND milestone='payment'",[key]);
 await shippingAction(container,admin,{action:'invoice',order_id:key,revision:2,amount_paise:2000,reference:'INV-adjust',note:'Verified invoice adjustment',confirmed:true});
 fees=(await db().query('SELECT SUM(amount_paise) AS n FROM hash_settlement WHERE order_id=$1',[key])).rows[0];assert.equal(Number(fees.n),47900);
 await shippingAction(container,admin,{action:'invoice',order_id:key,revision:3,amount_paise:0,reference:'CREDIT-test',note:'Verified full courier credit',confirmed:true});
 fees=(await db().query('SELECT SUM(amount_paise) AS n FROM hash_settlement WHERE order_id=$1',[key])).rows[0];assert.equal(Number(fees.n),49900);
 await assert.rejects(()=>shippingAction(container,{id:'foreign',vendor_id:'other'},{action:'invoice',order_id:key}));
 await assert.rejects(()=>shippingAction(container,admin,{action:'invoice',order_id:key,revision:1,amount_paise:10,reference:'INV',note:'stale invoice',confirmed:true}));
 fixture.status='canceled';fixture.canceled_at=new Date();await reconcileOrder(container,key);t=await tracking(key,customer);assert.equal(t.status,'canceled');
 console.log('Passed: mocked carrier quote/booking/sync roundtrip, booking isolation and duplicate prevention, carrier delivery cannot complete OTP; shipping fee holds, exact deductions, idempotent reconciliation, immutable paid amounts, invoice correction and credits, stale invoice rejection; repeatable migration, customer/vendor isolation, stage progression, stale revisions, timeline persistence, OTP-only completion, cancellation, label.');
 }finally{for(const table of ['hash_delivery_event','hash_shipment','hash_settlement','hash_order'])await db().query(`DELETE FROM ${table} WHERE order_id=$1`,[key]);await db().query('DELETE FROM hash_audit WHERE entity_id=$1',[key]);await db().query('DELETE FROM hash_listing WHERE product_id=$1',[product]);await db().query('DELETE FROM hash_vendor WHERE id=$1',[vendor]);await db().end()}
})().catch(e=>{console.error(e);process.exitCode=1});
