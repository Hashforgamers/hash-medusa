jest.mock('../db',()=>({db:jest.fn(),transaction:jest.fn(),audit:jest.fn()}))
jest.mock('../settlements',()=>({reconcileOrder:jest.fn()}))
import { deliveryCommand,validateDeliveryTransition,shippingLabel,tracking,updateDelivery } from '../delivery'
import { db,transaction } from '../db'
import { reconcileOrder } from '../settlements'
const order:any={order_id:'order_1',vendor_id:'v1',paid_at:new Date(),delivery_kind:'product',delivery_status:'placed',delivery_revision:0,delivery_details:{},created_at:new Date()}
describe('manual customer tracking',()=>{
 beforeEach(()=>jest.clearAllMocks())
 test('requires sequential stages and cannot mark delivered without OTP',()=>{
  expect(()=>validateDeliveryTransition(order,'preparing')).not.toThrow()
  for(const status of ['shipped','out_for_delivery','delivered','completed'])expect(()=>validateDeliveryTransition(order,status)).toThrow()
  expect(()=>validateDeliveryTransition({...order,delivery_status:'delivery_attempted'},'out_for_delivery')).not.toThrow()
 })
 test('supports distinct service stages',()=>{
  const service={...order,delivery_kind:'service',delivery_status:'preparing'}
  expect(()=>validateDeliveryTransition(service,'ready_for_service')).not.toThrow()
  expect(()=>validateDeliveryTransition(service,'shipped')).toThrow()
 })
 test.each([{paid_at:null},{completed_at:new Date()},{canceled_at:new Date()},{hold_reason:'Refund review'},{reviewed_canceled:true}])('blocks immutable or held orders: %j',patch=>expect(()=>validateDeliveryTransition({...order,...patch},'preparing')).toThrow())
 test('validates links and dates',()=>{
  const input={action:'update_delivery',order_id:'order_1',revision:0,status:'preparing'}
  expect(deliveryCommand.safeParse({...input,tracking_url:'https://courier.example/track/1',expected_delivery:'2026-12-12'}).success).toBe(true)
  for(const tracking_url of ['javascript:alert(1)','http://example.com','https://user:secret@example.com'])expect(deliveryCommand.safeParse({...input,tracking_url}).success).toBe(false)
  expect(deliveryCommand.safeParse({...input,expected_delivery:'2026-02-30'}).success).toBe(false)
 })
 test('customer lookup is ownership scoped and does not return private ledger data',async()=>{
  const query=jest.fn().mockResolvedValueOnce({rows:[{...order,otp_hash:'secret',net_paise:123,completed_at:new Date(),canceled_at:new Date()}]}).mockResolvedValueOnce({rows:[]});(db as jest.Mock).mockReturnValue({query})
  const value=await tracking('order_1','customer_1')
  expect(query.mock.calls[0][1]).toEqual(['order_1','customer_1']);expect(value.status).toBe('canceled');expect(value.completion_eligible).toBe(false);expect(JSON.stringify(value)).not.toMatch(/secret|net_paise|otp_hash/)
 })
 test('missing or foreign order returns no events',async()=>{
  const query=jest.fn().mockResolvedValue({rows:[]});(db as jest.Mock).mockReturnValue({query});await expect(tracking('other','customer_1')).rejects.toThrow('Order not found');expect(query).toHaveBeenCalledTimes(1)
 })
 test('foreign vendor cannot update or reconcile the order',async()=>{
  (db as jest.Mock).mockReturnValue({query:jest.fn().mockResolvedValue({rows:[order]})});await expect(updateDelivery({}, {vendor_id:'v2'}, {order_id:'order_1'} as any)).rejects.toThrow();expect(reconcileOrder).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled()
 })
 test('stale revisions cannot overwrite a newer update',async()=>{
  const query=jest.fn().mockResolvedValue({rows:[{...order,delivery_revision:2}]});(db as jest.Mock).mockReturnValue({query});(transaction as jest.Mock).mockImplementation((k,fn)=>fn({query}));await expect(updateDelivery({}, {vendor_id:'v1'}, {order_id:'order_1',revision:1} as any)).rejects.toThrow('Tracking changed');expect(query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true)
 })
 test('label escapes personal data, excludes OTP and bank data, and warns about unpaid orders',()=>{
  const html=shippingLabel({id:'order_1',items:[{quantity:2}],shipping_address:{first_name:'<script>alert(1)</script>',address_1:'Road & Lane',city:'Mumbai',country_code:'in',phone:'123'},otp:'123456'},{name:'Shop',bank_details:{account:'secret'},business_details:{}},{})
  expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('Road &amp; Lane');expect(html).toContain('PAYMENT NOT CONFIRMED');expect(html).not.toContain('123456');expect(html).not.toContain('secret');expect(html).toContain('size:A6')
 })
 test('missing shipping address cannot generate misleading label',()=>expect(()=>shippingLabel({id:'o'}, {}, {})).toThrow('shipping address'))
})
