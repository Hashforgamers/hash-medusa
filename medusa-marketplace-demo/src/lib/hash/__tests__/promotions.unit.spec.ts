import { promotionDefinition, promotionInput } from '../promotions'
import { GET,POST } from '../../../api/admin/hash/promotions/route'
import { actor } from '../access'
import { db,transaction } from '../db'
jest.mock('../access',()=>({...jest.requireActual('../access'),actor:jest.fn()}))
jest.mock('../db',()=>({db:jest.fn(),transaction:jest.fn(),audit:jest.fn()}))
const offer={code:'save10',discount_type:'percentage',value:10,currency_code:'inr'}
describe('Hash promotions',()=>{
 test.each([{value:101},{value:0},{code:'bad!code'},{starts_at:'2026-11-02T00:00:00.000Z',ends_at:'2026-11-01T00:00:00.000Z'},{usage_limit:0},{discount_type:'fixed',value:1.001}])('rejects invalid discount %j',change=>expect(promotionDefinition.safeParse({...offer,...change}).success).toBe(false))
 test('starts as draft and limits currency and selected products without discounting shipping',()=>{
  const p=promotionInput(promotionDefinition.parse({...offer,product_ids:['prod_a','prod_a'],usage_limit:5}))
  expect(p.status).toBe('draft');expect(p.code).toBe('SAVE10')
  expect(p.rules).toEqual([{attribute:'currency_code',operator:'eq',values:['inr']}])
  expect(p.application_method).toMatchObject({target_type:'items',allocation:'across',target_rules:[{attribute:'product_id',operator:'in',values:['prod_a']}]})
  expect(p.campaign.budget).toEqual({type:'usage',limit:5})
 })
 test('normalizes readable offer references into shareable codes',()=>{expect(promotionDefinition.parse({...offer,code:' Diwali  Sale '}).code).toBe('DIWALI-SALE')})
 test('fixed discounts use major units and automatic selection is explicit',()=>{
  const p=promotionInput(promotionDefinition.parse({...offer,discount_type:'fixed',value:25.5,automatic:true}))
  expect(p.application_method.value).toBe(25.5);expect(p.is_automatic).toBe(true)
 })
 test('vendors with no promotions cannot see global offers',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:false,id:'u',vendor_id:'v'})
  ;(db as jest.Mock).mockReturnValue({query:async()=>({rows:[]})})
  const listAndCountPromotions=jest.fn().mockResolvedValue([[],0]),json=jest.fn()
  await GET({query:{},scope:{resolve:()=>({listAndCountPromotions})}},{setHeader:jest.fn(),json})
  expect(listAndCountPromotions.mock.calls[0][0]).toEqual({id:['no-vendor-promotions']})
  expect(json.mock.calls[0][0].promotions).toEqual([])
 })
 test('vendors cannot toggle offers they do not own',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:false,id:'u',vendor_id:'v'})
  ;(transaction as jest.Mock).mockImplementation(async(_key,work)=>work({query:async()=>({rows:[{vendor_id:'other'}]})}))
  const retrievePromotion=jest.fn()
  await expect(POST({body:{action:'state',id:'promo_other',status:'active',updated_at:'2026-10-29T00:00:00.000Z'},scope:{resolve:()=>({retrieveUser:async()=>({metadata:{}}),retrievePromotion})}},{})).rejects.toThrow('Promotion not found')
  expect(retrievePromotion).not.toHaveBeenCalled()
 })
 test('temporary admin passwords cannot create offers',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:true,id:'test'})
  await expect(POST({scope:{resolve:()=>({retrieveUser:async()=>({metadata:{hash_password_change_required:true}})})}},{})).rejects.toThrow('Change your temporary password')
 })
})
