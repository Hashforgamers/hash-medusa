const query=jest.fn(),cancel=jest.fn(),release=jest.fn(),reconcile=jest.fn(),adjust=jest.fn()
jest.mock('../db',()=>({db:()=>({query}),transaction:async(_key,fn)=>fn({query}),audit:jest.fn()}))
jest.mock('../settlements',()=>({reconcileOrder:(...args)=>reconcile(...args),reviewAdjustment:(...args)=>adjust(...args)}))
import {completeCancellation,processCancellation,recordManualRefund} from '../cancellation-completion'
import {Modules} from '@medusajs/framework/utils'
const graph=jest.fn(),container={resolve:(name)=>{
 if(name===Modules.ORDER)return {cancel}
 if(name===Modules.INVENTORY)return {deleteReservationItemsByLineItem:release}
 if(name==='query')return {graph}
 throw Error('Unexpected service call '+name)
}}
const state={mode:'manual',status:'queued',approved_by:'admin',note:'Parcel remains with seller',updated_at:'2020-01-01'}
beforeEach(()=>{query.mockReset();cancel.mockReset();release.mockReset();graph.mockReset();reconcile.mockReset();adjust.mockReset()})
test('vendors cannot approve cancellation or record refunds',async()=>{
 await expect(completeCancellation(container,{superAdmin:false},{order_id:'QA'})).rejects.toThrow('Only Hash')
 await expect(recordManualRefund(container,{superAdmin:false},{order_id:'QA'})).rejects.toThrow('Only Hash')
 expect(query).not.toHaveBeenCalled()
})
test('a second processor leaves an active manual claim alone',async()=>{
 query.mockResolvedValue({rows:[{cancellation_request:{completion:{...state,status:'processing',updated_at:new Date().toISOString()}}}]})
 await processCancellation(container,'QA');expect(cancel).not.toHaveBeenCalled()
})
test('cancels and releases inventory while leaving the refund for Hash to handle manually',async()=>{
 query.mockImplementation(async sql=>sql.startsWith('SELECT * FROM hash_order')?{rows:[{cancellation_request:{completion:state},canceled_at:new Date(),captured_paise:2000,refunded_paise:0}]}:{rows:[]})
 graph.mockResolvedValue({data:[{status:'pending',items:[{id:'item_QA'}]}]})
 await processCancellation(container,'QA')
 expect(cancel).toHaveBeenCalledWith('QA');expect(release).toHaveBeenCalledWith(['item_QA'])
 expect(query.mock.calls.some(([sql,args])=>sql.includes("delivery_status='canceled'")&&args[1].refund.status==='manual_pending')).toBe(true)
})
test('recovers an old failed automatic refund approval using manual handling',async()=>{
 query.mockImplementation(async sql=>sql.startsWith('SELECT * FROM hash_order')?{rows:[{cancellation_request:{completion:{...state,mode:undefined,status:'needs_attention'}},canceled_at:new Date(),captured_paise:2000,refunded_paise:0}]}:{rows:[]})
 graph.mockResolvedValue({data:[{status:'canceled',items:[]}]})
 await processCancellation(container,'QA')
 expect(cancel).not.toHaveBeenCalled();expect(adjust).toHaveBeenCalled()
 expect(query.mock.calls.some(([sql,args])=>sql.includes("delivery_status='canceled'")&&args[1].completion.status==='complete')).toBe(true)
})
test('requires a confirmed cancellation and matching outstanding amount for a manual refund entry',async()=>{
 query.mockResolvedValue({rows:[{canceled_at:null}]})
 await expect(recordManualRefund(container,{superAdmin:true},{order_id:'QA'})).rejects.toThrow('Cancel the order')
 query.mockResolvedValue({rows:[{canceled_at:new Date(),captured_paise:2000,refunded_paise:0}]})
 await expect(recordManualRefund(container,{superAdmin:true},{order_id:'QA',amount_minor:1000})).rejects.toThrow('amount changed')
})
test('repeated manual receipt is idempotent and a different second receipt is rejected',async()=>{
 query.mockResolvedValue({rows:[{canceled_at:new Date(),cancellation_request:{manual_refund:{reference:'bank_QA'}}}]})
 await recordManualRefund(container,{superAdmin:true},{order_id:'QA',reference:'bank_QA'})
 expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false)
 await expect(recordManualRefund(container,{superAdmin:true},{order_id:'QA',reference:'bank_Other'})).rejects.toThrow('already been recorded')
})
