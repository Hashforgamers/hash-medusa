import RazorpayProvider, { paise } from '../service'
const options = { key_id: 'rzp_test_QAOnly', key_secret: 'test-secret-not-real' }
const session_id = 'payses_QAOnly'
let provider: RazorpayProvider, fetchMock: jest.Mock, data: any
const originalFetch = global.fetch
beforeEach(async () => {
  provider = new RazorpayProvider({}, options)
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'order_QAOnly', amount: 100101, currency: 'INR' }) })
  global.fetch = fetchMock
  data = (await provider.initiatePayment({ amount: 1001.01, currency_code: 'inr', context: { idempotency_key: session_id } })).data
  fetchMock.mockReset()
})
afterEach(() => { global.fetch = originalFetch })
function remote(overrides: any = {}, paymentOverrides: any = {}) {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: data.id, amount: data.amount, currency: 'INR', notes: { medusa_session_id: session_id }, status: 'paid', amount_paid: data.amount, amount_due: 0, ...overrides }) })
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'pay_QAOnly', order_id: data.id, status: 'captured', captured: true, amount: data.amount, currency: 'INR', amount_refunded: 0, ...paymentOverrides }] }) })
}
it('converts Medusa rupees to paise exactly', () => { expect(paise(1001.01)).toBe(100101); expect(() => paise(1.001)).toThrow(); expect(() => paise(0)).toThrow() })
it('returns app order id, paise and public key without a secret', () => { expect(data).toMatchObject({id:'order_QAOnly',amount:100101,key_id:options.key_id});expect(JSON.stringify(data)).not.toContain(options.key_secret) })
it('requires provider-confirmed paid order and matching captured payment', async () => {remote();expect((await provider.authorizePayment({ data, context: { idempotency_key: session_id } })).status).toBe('captured')})
it('rejects a forged session amount before contacting Razorpay', async () => {await expect(provider.authorizePayment({data:{...data,amount:1},context:{idempotency_key:session_id}})).rejects.toThrow('binding');expect(fetchMock).not.toHaveBeenCalled()})
it('rejects a payment reused for another session', async () => {await expect(provider.authorizePayment({data,context:{idempotency_key:'payses_Other'}})).rejects.toThrow('another session')})
it('keeps unpaid orders pending', async () => {remote({status:'created',amount_paid:0});expect((await provider.authorizePayment({data,context:{idempotency_key:session_id}})).status).toBe('pending')})
it.each([{amount:1},{currency:'USD'},{notes:{medusa_session_id:'payses_Other'}}])('rejects mismatched order %j', async override=>{remote(override);await expect(provider.authorizePayment({data,context:{idempotency_key:session_id}})).rejects.toThrow('match')})
it.each([{status:'authorized',captured:false},{amount:1},{order_id:'order_Other'},{amount_refunded:1}])('does not complete for invalid captured payment %j', async override=>{remote({},override);expect((await provider.authorizePayment({data,context:{idempotency_key:session_id}})).status).toBe('pending')})
it('rejects changed totals instead of using the old payment order', async()=>{await expect(provider.updatePayment({data,amount:2000,currency_code:'inr'})).rejects.toThrow('Cart total changed')})
it('fails closed on Razorpay outages',async()=>{fetchMock.mockRejectedValue(new Error('timeout'));await expect(provider.authorizePayment({data,context:{idempotency_key:session_id}})).rejects.toThrow('did not respond')})
it('does not claim refunds or paid cancellation succeeded',async()=>{await expect(provider.refundPayment({data,amount:10})).rejects.toThrow('reconciliation');remote();await expect(provider.cancelPayment({data})).rejects.toThrow('already captured')})
it('does not accept unsigned webhook payment claims',async()=>{expect(await provider.getWebhookActionAndData({} as any)).toEqual({action:'not_supported'})})

it('records only provider-confirmed gateway fees and does not add GST twice',async()=>{remote({}, {fee:236,tax:36});const r=await provider.authorizePayment({data:{...data,gateway_fee_minor:99999},context:{idempotency_key:session_id}});expect(r.data).toMatchObject({gateway_fee_minor:236,gateway_tax_minor:36})})
it('drops client-supplied fees when the provider fee is unknown',async()=>{remote();const r=await provider.authorizePayment({data:{...data,gateway_fee_minor:99999,gateway_tax_minor:1},context:{idempotency_key:session_id}});expect(r.data.gateway_fee_minor).toBeUndefined();expect(r.data.gateway_tax_minor).toBeUndefined()})
