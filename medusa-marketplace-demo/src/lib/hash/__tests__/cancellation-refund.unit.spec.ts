const query=jest.fn()
jest.mock('../db',()=>({transaction:async(_key,fn)=>fn({query})}))
import { cancellationRefund } from '../cancellation-refund'
const data={session_id:'payses_QA',id:'order_QA',amount:2000,key_id:'rzp_test_QA'}
const intent={session_id:data.session_id,amount_minor:2000,key_id:data.key_id,payment_id:'pay_QA',refund_id:null,medusa_refund_id:null}
const payment={id:'pay_QA',order_id:data.id,currency:'INR',amount:2000,status:'captured'}
const refund={id:'rfnd_QA',payment_id:'pay_QA',amount:2000,currency:'INR',status:'processed'}
beforeEach(()=>query.mockReset())
test('requires durable approval before any remote refund',async()=>{
 query.mockResolvedValue({rows:[]});const request=jest.fn()
 await expect(cancellationRefund(data,2000,'ref_QA',request)).rejects.toThrow('Approve')
 expect(request).not.toHaveBeenCalled()
})
test('retries an uncertain submission with the same provider key and body even if Medusa replaces its refund row',async()=>{
 query.mockResolvedValue({rows:[intent]})
 const request=jest.fn().mockResolvedValueOnce(payment).mockRejectedValueOnce(Error('timeout')).mockResolvedValueOnce(payment).mockResolvedValueOnce(refund)
 await expect(cancellationRefund(data,2000,'ref_First',request)).rejects.toThrow('timeout')
 await expect(cancellationRefund(data,2000,'ref_Retry',request)).resolves.toMatchObject({data:{cancellation_refund_id:'rfnd_QA'}})
 expect(request.mock.calls[1]).toEqual(request.mock.calls[3])
 expect(request.mock.calls[3][2]['X-Refund-Idempotency']).toMatch(/^hash_cancel_/)
})
test('persists a pending refund but does not report money refunded',async()=>{
 query.mockResolvedValue({rows:[intent]});const request=jest.fn().mockResolvedValueOnce(payment).mockResolvedValueOnce({...refund,status:'pending'})
 await expect(cancellationRefund(data,2000,'ref_QA',request)).rejects.toThrow('pending')
 expect(query.mock.calls[query.mock.calls.length-1][1]).toEqual([data.session_id,'rfnd_QA','pending','ref_QA'])
})
test('polls an existing refund instead of creating another',async()=>{
 query.mockResolvedValue({rows:[{...intent,refund_id:'rfnd_QA'}]});const request=jest.fn().mockResolvedValueOnce(payment).mockResolvedValueOnce(refund)
 await cancellationRefund(data,2000,'ref_QA',request)
 expect(request.mock.calls[1]).toEqual(['/refunds/rfnd_QA'])
})
test('rejects a mismatched payment and refund amount',async()=>{
 query.mockResolvedValue({rows:[intent]});const request=jest.fn().mockResolvedValue({...payment,order_id:'order_Other'})
 await expect(cancellationRefund(data,2000,'ref_QA',request)).rejects.toThrow('does not match')
 expect(request).toHaveBeenCalledTimes(1)
 await expect(cancellationRefund(data,1000,'ref_QA',request)).rejects.toThrow('Approve')
})
test('does not record a second Medusa refund for the same approved cancellation',async()=>{
 query.mockResolvedValueOnce({rows:[{...intent,medusa_refund_id:'ref_Existing'}]}).mockResolvedValueOnce({rows:[{id:'ref_Existing'}],rowCount:1})
 const request=jest.fn()
 await expect(cancellationRefund(data,2000,'ref_Other',request)).rejects.toThrow('already recorded')
 expect(request).not.toHaveBeenCalled()
})
