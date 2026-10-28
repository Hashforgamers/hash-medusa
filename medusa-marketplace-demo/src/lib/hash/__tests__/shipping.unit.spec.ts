import { estimatePaise,carrierStage,parcelSchema,shippingCommands,delhiveryRequest,definiteBookingRejection } from '../delhivery'
import { shippingAllocation } from '../shipping-fees'
describe('Delhivery safety and vendor charges',()=>{
 test('only explicit empty/rejected manifests are safe to retry',()=>{
  expect(definiteBookingRejection({success:false,package_count:0,packages:[],rmk:'Please recharge wallet'})).toContain('funding')
  expect(definiteBookingRejection({success:false,packages:[{status:'Fail',remarks:['Pickup location not found']}]})).toContain('pickup location')
  for(const r of [{},{success:false},{success:false,packages:[]},{success:false,package_count:0,packages:[{status:'Success',waybill:'123456789'}]}])expect(definiteBookingRejection(r)).toBeNull()
 })

 test('charges actual shipping without markup and tracks overpayment',()=>{expect(shippingAllocation(10000,1500,5000,5000)).toEqual({available:3500,payment:3500,recovery:0});expect(shippingAllocation(10000,1500,10000,5000)).toEqual({available:0,payment:0,recovery:1500})})
 test('a reduced or zero courier invoice releases the correct remainder',()=>{expect(shippingAllocation(10000,0,5000,5000).available).toBe(5000);expect(shippingAllocation(3000,1500,5000,1500).recovery).toBe(3500)})
 test('estimate rejects missing, ambiguous, free and negative charges',()=>{expect(estimatePaise([{total_amount:51.12}])).toBe(5112);for(const v of [[],{},[{total_amount:0}],[{total_amount:-1}],[{total_amount:10},{total_amount:20}]])expect(()=>estimatePaise(v)).toThrow()})
 test('physical dimensions and weights must be explicit and bounded',()=>{expect(parcelSchema.safeParse({weight_g:0,length_cm:2,width_cm:2,height_cm:2,mode:'Surface',invoice:'INV'}).success).toBe(false)})
 test('invoice amounts are integer paise and require confirmation and evidence',()=>{expect(shippingCommands.safeParse({action:'invoice',order_id:'o',revision:1,amount_paise:10.5,reference:'INV',note:'verified invoice',confirmed:true}).success).toBe(false)})
 test('carrier delivery cannot complete the OTP milestone',()=>{expect(carrierStage('Delivered','DL')).toBe('carrier_delivered');expect(carrierStage('Delivered','RT')).toBe('return_in_progress');expect(carrierStage('Dispatched','UD')).toBe('out_for_delivery');expect(carrierStage('Pending','UD')).toBe('carrier_update');expect(carrierStage('Picked Up','UD')).toBe('shipped')})
 test('carrier requests never follow redirects and credentials stay in headers',async()=>{const old=global.fetch;global.fetch=jest.fn().mockResolvedValue({ok:true,text:async()=>'{"success":true}'}) as any;try{await delhiveryRequest('secret','/api/cmu/create.json',{shipments:[{name:'A & B'}]});const [url,opts]=(global.fetch as jest.Mock).mock.calls[0];expect(url).not.toContain('secret');expect(opts.redirect).toBe('error');expect(opts.headers.Authorization).toBe('Token secret');expect(new URLSearchParams(opts.body).get('data')).toContain('A & B')}finally{global.fetch=old}})
})

import { packedEstimate,cartFingerprint } from '../checkout-shipping'
describe('customer delivery estimates',()=>{
 const listings=[{product_id:'a',kind:'product',shipping_package:{weight_g:200,length_cm:20,width_cm:10,height_cm:3}}]
 test('uses unit measurements and quantities without inventing a weight',()=>{expect(packedEstimate([{product_id:'a',quantity:2}],listings)).toEqual({weight_g:400,length_cm:20,width_cm:10,height_cm:6});expect(()=>packedEstimate([{product_id:'b',quantity:1}],listings)).toThrow()})
 test('cart identity changes for address and quantity, but not payment details',()=>{const c={currency_code:'inr',items:[{product_id:'a',quantity:1}],shipping_address:{postal_code:'560001'}};expect(cartFingerprint(c)).not.toBe(cartFingerprint({...c,items:[{product_id:'a',quantity:2}]}));expect(cartFingerprint(c)).not.toBe(cartFingerprint({...c,shipping_address:{postal_code:'110001'}}));expect(cartFingerprint(c)).toBe(cartFingerprint({...c,payment_collection:{id:'p'}}))})
 test('oversized or missing measurements block quoting',()=>{expect(()=>packedEstimate([{product_id:'a',quantity:1000}],listings)).toThrow();expect(()=>packedEstimate([{product_id:'a',quantity:1}],[{product_id:'a',kind:'product'}])).toThrow()})
})
