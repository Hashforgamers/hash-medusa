import { cardEligible,cardAmounts,withCatalogOffers } from '../catalog-offers'
const product={product_id:'prod_a',variant_id:'variant_a',prices:[{currency_code:'inr',amount:10}]}
const offer={id:'promo_a',code:'SALE30',type:'standard',status:'active',is_automatic:true,rules:[{attribute:'currency_code',operator:'eq',values:[{value:'inr'}]}],application_method:{type:'percentage',value:30,currency_code:'inr',target_type:'items',allocation:'across',target_rules:[{attribute:'product_id',operator:'in',values:[{value:'prod_a'}]}]},campaign:{campaign_identifier:'hash-SALE30'}}
test('30 percent off INR 10 is INR 3 discount and INR 7 selling price',()=>{expect(cardAmounts(10,[{action:'addItemAdjustment',item_id:'i',amount:3}],'i','inr')).toMatchObject({original_amount:10,discount_amount:3,calculated_amount:7,discount_percent:30,original_amount_minor:1000,discount_amount_minor:300,calculated_amount_minor:700})})
test('expired, future, exhausted, cross-product and cross-currency offers are not advertised',()=>{
 expect(cardEligible(offer,product,'inr')).toBe(true)
 expect(cardEligible(offer,{...product,product_id:'other'},'inr')).toBe(false);expect(cardEligible(offer,product,'usd')).toBe(false)
 for(const c of [{ends_at:'2020-01-01'},{starts_at:'2099-01-01'},{budget:{limit:1,used:1}}])expect(cardEligible({...offer,campaign:c},product,'inr')).toBe(false)
})
test('customer, basket and buy-get restrictions cannot become unconditional card prices',()=>{
 expect(cardEligible({...offer,rules:[{attribute:'customer_id',operator:'eq',values:[{value:'cust'}]}]},product,'inr')).toBe(false)
 expect(cardEligible({...offer,type:'buyget'},product,'inr')).toBe(false)
 expect(cardEligible({...offer,application_method:{...offer.application_method,target_type:'shipping_methods'}},product,'inr')).toBe(false)
})
test('coupon previews are separate from automatic card prices and native engine controls stacking',async()=>{
 const coupon={...offer,id:'coupon',code:'CODE',is_automatic:false},computeActions=jest.fn(async codes=>[{action:'addItemAdjustment',item_id:'preview_prod_a',amount:codes.includes('CODE')?2:3}]);
 const results=await withCatalogOffers({resolve:()=>({listPromotions:async()=>[offer,coupon],computeActions})},[product],'inr');expect(results[0].pricing.calculated_amount).toBe(7);expect(results[0].offers[1]).toMatchObject({code:'CODE',requires_code:true,price_after_discount:8});expect(computeActions.mock.calls[0][0]).toEqual(['SALE30'])
})
test('discount cannot exceed product price; wrong-item and budget-exceeded actions are excluded',()=>{expect(cardAmounts(10,[{action:'campaignBudgetExceeded',code:'X'},{action:'addItemAdjustment',item_id:'other',amount:5},{action:'addItemAdjustment',item_id:'i',amount:20}],'i','inr').calculated_amount_minor).toBe(0)})
test('missing currency price never gets an invented converted amount',async()=>{const r=await withCatalogOffers({resolve:()=>({listPromotions:async()=>[]})},[product],'usd');expect(r[0]).toMatchObject({pricing:null,offers:[]})})
