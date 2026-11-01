import { commercialTerms,pricePreview,commercialSchema } from '../commercial'
import { accountBreakdown } from '../accounts'
describe('agreed pilot pricing',()=>{
 const vendor={commission_bps:500,commercial_revision:1,commercial_terms:{enabled:true,pilot_start:'2026-01-01T00:00:00.000Z',pilot_days:90,pilot_commission_bps:300,platform_fee_minor:1000,platform_tax_bps:1800,regular_commission_bps:null,category_rates:{}}}
 test('the INR 2000 example totals 2010, seller receives 1940, gateway is only an estimate',()=>{const p=pricePreview(200000,0,commercialTerms(vendor,new Date('2026-02-01')));expect(p).toMatchObject({customer_total_minor:201000,commission_minor:6000,seller_before_courier_minor:194000,gateway_estimate_minor:4744,hash_contribution_estimate_minor:2256,platform_fee_tax_minor:153})})
 test('90 day pilot ends at exact boundary without inventing a regular rate',()=>{expect(commercialTerms(vendor,new Date('2026-03-31T23:59:59Z')).phase).toBe('pilot');expect(commercialTerms(vendor,new Date('2026-04-01')).phase).toBe('pilot_expired_review_required');expect(commercialTerms(vendor,new Date('2026-04-01')).commission_bps).toBe(300)})
 test('agreed rate starts only after the pilot; scheduled terms do not charge a fee',()=>{const v={...vendor,commercial_terms:{...vendor.commercial_terms,regular_commission_bps:800}};expect(commercialTerms(v,new Date('2026-04-01')).commission_bps).toBe(800);expect(commercialTerms(v,new Date('2025-12-31')).platform_fee_minor).toBe(0)})
 test('draft pricing cannot affect customer totals',()=>{expect(commercialTerms({...vendor,commercial_terms:{...vendor.commercial_terms,enabled:false}}).platform_fee_minor).toBe(0)})
 test('active terms require agreement evidence',()=>{expect(commercialSchema.safeParse({vendor_id:'v',revision:0,...vendor.commercial_terms,agreement_reference:''}).success).toBe(false)})
})
describe('partner account reporting',()=>{
 const order={order_id:'o',vendor_id:'v',currency_code:'inr',total_paise:201000,net_paise:194000,platform_fee_paise:1000,shipping_fee_paise:10000,captured_paise:201000,refunded_paise:0,reviewed_refund_paise:-1,paid_at:new Date(),payment_mode:'hash_collects',paid:50000,processing:10000,due:50000,gateway_fee_paise:4744}
 test('platform fee is Hash revenue, gateway is Hash cost, courier reduces seller earnings once',()=>{expect(accountBreakdown(order)).toMatchObject({commission_minor:6000,seller_entitlement_minor:184000,balance_minor:134000,ready_minor:50000,future_minor:74000,contribution_minor:2256})})
 test('holds never label funds ready; processing is not reported as paid',()=>{expect(accountBreakdown({...order,hold_reason:'Refund review'})).toMatchObject({ready_minor:0,held_minor:124000,paid_minor:50000,processing_minor:10000})})
 test('unpaid orders do not inflate recognized earnings',()=>{expect(accountBreakdown({...order,paid_at:null,paid:0,processing:0})).toMatchObject({seller_entitlement_minor:0,commission_minor:0,balance_minor:0})})
 test('overpayment is a recovery, not an extra pending payout',()=>{expect(accountBreakdown({...order,paid:200000,processing:0})).toMatchObject({balance_minor:-16000,recovery_minor:16000,ready_minor:0,future_minor:0})})
 test('unknown gateway charge stays unknown, not estimated as an actual charge',()=>{expect(accountBreakdown({...order,gateway_fee_paise:null}).contribution_minor).toBeNull()})
})

import { assertAutomaticPayout } from '../payout-connectors'
describe('automatic payout authorization',()=>{
 const s={auto_payout:true,status:'scheduled',amount_paise:1000,auto_payout_daily_minor:5000}
 test('manual mode and failed or uncertain transfers never auto retry',()=>{for(const change of [{auto_payout:false},{status:'failed'},{status:'processing'},{status:'paid'}])expect(()=>assertAutomaticPayout({...s,...change},0)).toThrow()})
 test('rolling cap includes reserved transfers and fails closed on invalid totals',()=>{expect(()=>assertAutomaticPayout(s,4000)).not.toThrow();for(const n of [4001,NaN,-1])expect(()=>assertAutomaticPayout(s,n)).toThrow()})
})
test('configurable gateway estimates do not reduce seller entitlement',()=>{const r=pricePreview(200000,0,{commission_bps:300,platform_fee_minor:1000,platform_tax_bps:1800,gateway_estimate_bps:0,gateway_tax_bps:1800});expect(r.gateway_estimate_minor).toBe(0);expect(r.seller_before_courier_minor).toBe(194000)})
test('automatic transfer bounds leave out-of-range settlements for review',()=>{const s={auto_payout:true,status:'scheduled',amount_paise:1000,auto_payout_daily_minor:10000,auto_payout_min_minor:1001};expect(()=>assertAutomaticPayout(s,0)).toThrow('amount range');expect(()=>assertAutomaticPayout({...s,auto_payout_min_minor:0,auto_payout_max_minor:999},0)).toThrow('amount range');expect(()=>assertAutomaticPayout({...s,auto_payout_min_minor:1000,auto_payout_max_minor:1000},0)).not.toThrow()})

test('customer delivery collected offsets the courier bill exactly once',()=>{
 const o=accountBreakdown({order_id:'o',currency_code:'inr',total_paise:211000,net_paise:204000,platform_fee_paise:1000,customer_shipping_paise:10000,shipping_fee_paise:12000,captured_paise:211000,refunded_paise:0,paid_at:new Date(),payment_mode:'hash_collects',courier_final:true});
 expect(o).toMatchObject({customer_delivery_minor:10000,commission_minor:6000,courier_fee_minor:12000,settlement_gross_minor:211000,total_deductions_minor:19000,seller_entitlement_minor:192000,settlement_final:true});
 expect(o.settlement_gross_minor-o.total_deductions_minor).toBe(o.seller_entitlement_minor);
});
test('unreconciled courier charges produce provisional earnings held from payout',()=>{
 const o=accountBreakdown({total_paise:200000,net_paise:194000,captured_paise:200000,paid_at:new Date(),payment_mode:'hash_collects',courier_final:false,payout_block_reason:'Final courier charge must be reconciled before payout',courier_estimate_paise:10000,due:194000});
 expect(o).toMatchObject({settlement_final:false,courier_estimate_minor:10000,ready_minor:0,held_minor:194000});
});

test('post-pilot gateway setting preserves Hash funding throughout the pilot',()=>{
 const v={commission_bps:300,commercial_revision:4,commercial_terms:{enabled:true,pilot_start:'2026-01-01T00:00:00Z',pilot_days:90,pilot_commission_bps:300,regular_commission_bps:800,regular_gateway_payer:'vendor',platform_fee_minor:1000,platform_tax_bps:1800,category_rates:{}}};
 expect(commercialTerms(v,new Date('2026-02-01')).gateway_payer).toBe('hash');
 expect(commercialTerms(v,new Date('2026-04-01')).gateway_payer).toBe('vendor');
 expect(commercialTerms({...v,commercial_terms:{...v.commercial_terms,regular_gateway_payer:undefined}},new Date('2026-04-01')).gateway_payer).toBe('hash');
});
test('vendor gateway funding is deducted once from the order snapshot, not current partner terms',()=>{
 const base={total_paise:201000,net_paise:194000,platform_fee_paise:1000,shipping_fee_paise:10000,captured_paise:201000,paid_at:new Date(),payment_mode:'hash_collects',gateway_fee_paise:4744};
 const vendor=accountBreakdown({...base,commercial_snapshot:{gateway_payer:'vendor'}});
 expect(vendor).toMatchObject({gateway_payer:'vendor',vendor_gateway_fee_minor:4744,seller_entitlement_minor:179256,contribution_minor:7000,hash_gateway_cost_minor:0});
 expect(accountBreakdown(base)).toMatchObject({gateway_payer:'hash',vendor_gateway_fee_minor:0,seller_entitlement_minor:184000,hash_gateway_cost_minor:4744});
});

describe('cancellation and refund reporting',()=>{
 const order={total_paise:10000,captured_paise:10000,net_paise:9700,paid_at:new Date(),payment_mode:'hash_collects',due:9700,currency_code:'inr'}
 test('a courier request holds the sale without claiming the customer was refunded',()=>{
  expect(accountBreakdown({...order,cancellation_request:{status:'courier_requested'}})).toMatchObject({cancellation_state:'Cancellation requested',ready_minor:0,held_minor:9700,customer_refunded_minor:0,no_sale_payout:false})
 })
 test('confirmed cancellation removes stale sale earnings and identifies prior transfers and actual costs',()=>{
  expect(accountBreakdown({...order,canceled_at:new Date(),shipping_fee_paise:500,paid:2000,gateway_fee_paise:236})).toMatchObject({seller_entitlement_minor:-500,hash_gateway_cost_minor:236,ready_minor:0,recovery_minor:2500,refund_outstanding_minor:10000})
 })
 test('full refund before review blocks the sale; partial refund is separately classified',()=>{
  expect(accountBreakdown({...order,refunded_paise:10000})).toMatchObject({cancellation_state:'Fully refunded',seller_entitlement_minor:0,ready_minor:0})
  expect(accountBreakdown({...order,refunded_paise:2000,hold_reason:'Refund requires Hash review'})).toMatchObject({cancellation_state:'Partial refund',no_sale_payout:false,ready_minor:0})
 })
})
