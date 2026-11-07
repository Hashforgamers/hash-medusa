const query=jest.fn(),run=jest.fn(),reconcile=jest.fn(),adjust=jest.fn()
jest.mock('../db',()=>({db:()=>({query}),transaction:async(_key,fn)=>fn({query}),audit:jest.fn()}))
jest.mock('@medusajs/core-flows',()=>({cancelOrderWorkflow:()=>({run})}))
jest.mock('../settlements',()=>({reconcileOrder:(...args)=>reconcile(...args),reviewAdjustment:(...args)=>adjust(...args)}))
import {completeCancellation,processCancellation} from '../cancellation-completion'
const graph=jest.fn(),container={resolve:()=>({graph})}
const state={status:'queued',approved_by:'admin',note:'Parcel remains with seller',updated_at:'2020-01-01'}
beforeEach(()=>{query.mockReset();run.mockReset();graph.mockReset();reconcile.mockReset();adjust.mockReset()})
test('vendors cannot approve refunds',async()=>{
 await expect(completeCancellation(container,{superAdmin:false},{order_id:'order_QA'})).rejects.toThrow('Only Hash')
 expect(query).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled()
})
test('a second processor leaves an active durable claim alone',async()=>{
 query.mockResolvedValue({rows:[{cancellation_request:{completion:{...state,status:'processing',updated_at:new Date().toISOString()}}}]})
 await processCancellation(container,'order_QA');expect(run).not.toHaveBeenCalled()
})
test('resumes reconciliation after order cancellation without refunding again',async()=>{
 query.mockImplementation(async sql=>sql.startsWith('SELECT * FROM hash_order')?{rows:[{cancellation_request:{completion:state},canceled_at:new Date(),captured_paise:1000,refunded_paise:1000}]}:{rows:[]})
 graph.mockResolvedValue({data:[{status:'canceled'}]})
 await processCancellation(container,'order_QA')
 expect(run).not.toHaveBeenCalled();expect(adjust).toHaveBeenCalled()
 expect(query.mock.calls.some(([sql,args])=>sql.includes("delivery_status='canceled'")&&args[1].status==='closed')).toBe(true)
})
test('persists provider delay for automatic recovery instead of completing',async()=>{
 query.mockImplementation(async sql=>sql.startsWith('SELECT * FROM hash_order')?{rows:[{cancellation_request:{completion:state}}]}:sql.startsWith('SELECT status FROM hash_cancellation_refund')?{rows:[{status:'pending'}]}:{rows:[]})
 graph.mockResolvedValue({data:[{status:'pending'}]});run.mockRejectedValue(Error('Refund pending'))
 await processCancellation(container,'order_QA')
 expect(query.mock.calls.some(([sql,args])=>sql.startsWith('UPDATE hash_order')&&args[1].status==='refund_pending')).toBe(true)
 expect(adjust).not.toHaveBeenCalled()
})
test('saves a useful failure and never marks an incomplete refund complete',async()=>{
 query.mockImplementation(async sql=>sql.startsWith('SELECT * FROM hash_order')?{rows:[{cancellation_request:{completion:state},canceled_at:new Date(),captured_paise:1000,refunded_paise:0}]}:{rows:[]})
 graph.mockResolvedValue({data:[{status:'canceled'}]})
 await processCancellation(container,'order_QA')
 expect(query.mock.calls.some(([sql,args])=>sql.startsWith('UPDATE hash_order')&&args[1].status==='needs_attention')).toBe(true)
 expect(query.mock.calls.some(([sql])=>sql.includes("delivery_status='canceled'"))).toBe(false)
})
