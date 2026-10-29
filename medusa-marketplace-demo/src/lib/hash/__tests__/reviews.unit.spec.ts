import { reviewSubmission,reviewModeration,reviewRevision,pagination,moderateReview,reviewEligibility } from '../reviews'
import { POST } from '../../../api/admin/hash/reviews/route'
import { actor } from '../access'
import { db } from '../db'
jest.mock('../db',()=>({db:jest.fn(),transaction:jest.fn(),audit:jest.fn()}))
jest.mock('../access',()=>({...jest.requireActual('../access'),actor:jest.fn()}))
const valid={product_id:'prod_1',order_id:'order_1',rating:1,title:'Honest feedback',body:'The item did not meet my expectations.'}
describe('customer product reviews',()=>{
 test.each([0,6,1.5,NaN])('rejects invalid rating %s',rating=>expect(reviewSubmission.safeParse({...valid,rating}).success).toBe(false))
 test('accepts negative reviews and trims content without trusting client identity/status',()=>{
  expect(reviewSubmission.parse({...valid,title:'  Honest feedback  '}).title).toBe('Honest feedback')
  for(const extra of [{customer_id:'other'},{status:'approved'},{verified_purchase:true}])expect(reviewSubmission.safeParse({...valid,...extra}).success).toBe(false)
 })
 test.each([{body:'short'},{body:'x'.repeat(3001)},{title:'x'.repeat(121)},{revision:0}])('rejects malformed review %j',extra=>expect(reviewSubmission.safeParse({...valid,...extra}).success).toBe(false))
 test('requires a reason for hiding a review and validates moderation revision',()=>{
  expect(reviewModeration.safeParse({id:'r',revision:1,status:'rejected',note:''}).success).toBe(false)
  expect(reviewModeration.safeParse({id:'r',revision:1,status:'approved'}).success).toBe(true)
  expect(reviewRevision.safeParse({revision:0}).success).toBe(false)
 })
 test('rejects unbounded or invalid pagination',()=>{
  expect(pagination({})).toEqual({offset:0,limit:20})
  for(const q of [{limit:101},{limit:0},{offset:-1},{offset:'invalid'}])expect(()=>pagination(q)).toThrow()
 })
 test('vendor cannot moderate through route or service',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:false})
  const resolve=jest.fn();await expect(POST({scope:{resolve}},{})).rejects.toThrow('Only Hash administrators')
  await expect(moderateReview({superAdmin:false},{} as any)).rejects.toThrow('Only Hash administrators')
  expect(resolve).not.toHaveBeenCalled();expect(db).not.toHaveBeenCalled()
 })
 test('temporary admin credentials cannot moderate',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:true,id:'u'})
  await expect(POST({scope:{resolve:()=>({retrieveUser:async()=>({metadata:{hash_password_change_required:true}})})}},{})).rejects.toThrow('Change your temporary password')
 })
 test('an owned order awaiting asynchronous ledger creation is ineligible, not missing',async()=>{
  ;(db as jest.Mock).mockReturnValue({query:jest.fn().mockResolvedValue({rows:[]})})
  const scope={resolve:()=>({graph:async()=>({data:[{customer_id:'c',items:[{product_id:'p'}]}]})})}
  expect(await reviewEligibility(scope,'c','o','p')).toMatchObject({eligible:false})
 })

})
