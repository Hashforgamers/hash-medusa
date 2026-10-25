import { db } from '../../lib/hash/db'
import { decryptCredential } from '../../lib/hash/payout-connectors'
import { AbstractPaymentProvider, BigNumber, PaymentSessionStatus } from '@medusajs/framework/utils'
import type { InitiatePaymentInput, UpdatePaymentInput, AuthorizePaymentInput, CapturePaymentInput, RefundPaymentInput, CancelPaymentInput, DeletePaymentInput, RetrievePaymentInput, GetPaymentStatusInput, ProviderWebhookPayload, WebhookActionResult } from '@medusajs/framework/types'
import { createHmac, timingSafeEqual } from 'crypto'

type Options = { key_id?: string; key_secret?: string; mode?: 'test' | 'live' }
export function paise(amount: any): number {
  const value = Number(new BigNumber(amount).numeric) * 100
  const rounded = Math.round(value)
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || Math.abs(value - rounded) > 0.000001) throw Error('Razorpay requires a positive INR amount with at most two decimal places')
  return rounded
}
export default class RazorpayProvider extends AbstractPaymentProvider<Options> {
  static identifier = 'razorpay'
  private options: Options
  constructor(container: any, options: Options) { super(container, options); this.options = options }
  private async bound() {
    const { rows: [config] } = await db().query('SELECT * FROM hash_razorpay_config WHERE mode=$1 AND active AND verified_at IS NOT NULL', [this.options.mode])
    if (!config) throw Error('Verify the Razorpay account in Hash Operations before using checkout')
    return new RazorpayProvider({}, { key_id: config.key_id, key_secret: decryptCredential(config.secret_encrypted) })
  }
  static validateOptions(options: Options) {
    if (options.mode === 'live' || options.mode === 'test') return
    if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(options.key_id || '') || !options.key_secret) throw Error('Configure Razorpay key ID and secret on the server')
  }
  private async request(path: string, body?: any) {
    if (this.options.key_id.startsWith('rzp_live_') && process.env.HASH_DEMO_MODE === 'true') throw Error('Live Razorpay checkout is disabled in demo mode')
    let response: Response
    try {
      response = await fetch('https://api.razorpay.com/v1' + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Basic ' + Buffer.from(this.options.key_id + ':' + this.options.key_secret).toString('base64'), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch { throw Error('Razorpay did not respond. Check the payment status before retrying checkout.') }
    if (!response.ok) throw Error(`Razorpay request failed (HTTP ${response.status})`)
    return response.json()
  }
  private signature(data: any) {
    return createHmac('sha256', this.options.key_secret).update(JSON.stringify([data.id, data.amount, data.currency, data.session_id, data.key_id])).digest('hex')
  }
  private validate(data: any) {
    if (!data || !/^order_[A-Za-z0-9]+$/.test(data.id) || !/^payses_[A-Za-z0-9]+$/.test(data.session_id) || !Number.isSafeInteger(data.amount) || data.amount <= 0 || data.currency !== 'INR' || data.key_id !== this.options.key_id || !/^[a-f0-9]{64}$/.test(data.binding || '')) throw Error('Invalid Razorpay payment session')
    if (!timingSafeEqual(Buffer.from(data.binding, 'hex'), Buffer.from(this.signature(data), 'hex'))) throw Error('Invalid Razorpay payment session binding')
    return data
  }
  async initiatePayment(input: InitiatePaymentInput) {
    if (this.options.mode) return (await this.bound()).initiatePayment(input)

    if (input.currency_code.toLowerCase() !== 'inr') throw Error('Razorpay checkout currently supports INR')
    const session_id = input.context?.idempotency_key
    if (!session_id || !/^payses_[A-Za-z0-9]+$/.test(session_id)) throw Error('Missing Medusa payment session context')
    const amount = paise(input.amount)
    const order = await this.request('/orders', { amount, currency: 'INR', receipt: session_id, partial_payment: false, notes: { medusa_session_id: session_id } })
    if (!/^order_[A-Za-z0-9]+$/.test(order.id) || order.amount !== amount || order.currency !== 'INR') throw Error('Unexpected Razorpay order response')
    const data: any = { id: order.id, amount, currency: 'INR', key_id: this.options.key_id, session_id }
    data.binding = this.signature(data)
    return { id: order.id, data, status: PaymentSessionStatus.PENDING }
  }
  private async verified(data: any) {
    data = this.validate(data)
    const order = await this.request('/orders/' + data.id)
    if (order.id !== data.id || order.amount !== data.amount || order.currency !== data.currency || order.notes?.medusa_session_id !== data.session_id) throw Error('Razorpay order does not match this checkout')
    if (order.status !== 'paid' || order.amount_paid !== data.amount || order.amount_due !== 0) return { data, status: PaymentSessionStatus.PENDING }
    const payments = await this.request('/orders/' + data.id + '/payments')
    const payment = payments.items?.find((p: any) => p.order_id === data.id && p.status === 'captured' && p.captured === true && p.amount === data.amount && p.currency === data.currency && (p.amount_refunded || 0) === 0)
    if (!payment || !/^pay_[A-Za-z0-9]+$/.test(payment.id)) return { data, status: PaymentSessionStatus.PENDING }
    return { data: { ...data, payment_id: payment.id }, status: PaymentSessionStatus.CAPTURED }
  }
  async authorizePayment(input: AuthorizePaymentInput) {
    if (this.options.mode) return (await this.bound()).authorizePayment(input)

    const data = this.validate(input.data)
    if (input.context?.idempotency_key !== data.session_id) throw Error('Razorpay payment belongs to another session')
    return this.verified(data)
  }
  async getPaymentStatus(input: GetPaymentStatusInput) {
    if (this.options.mode) return (await this.bound()).getPaymentStatus(input)
 const result = await this.verified(input.data); return { status: result.status } }
  async capturePayment(input: CapturePaymentInput) {
    if (this.options.mode) return (await this.bound()).capturePayment(input)

    const result = await this.verified(input.data)
    if (result.status !== PaymentSessionStatus.CAPTURED) throw Error('Razorpay payment has not been captured. Enable automatic capture in Razorpay.')
    return { data: result.data }
  }
  async retrievePayment(input: RetrievePaymentInput) {
    if (this.options.mode) return (await this.bound()).retrievePayment(input)
 const result = await this.verified(input.data); return { data: result.data } }
  async updatePayment(input: UpdatePaymentInput) {
    if (this.options.mode) return (await this.bound()).updatePayment(input)

    const data = this.validate(input.data)
    if (input.currency_code.toUpperCase() !== data.currency || paise(input.amount) !== data.amount) throw Error('Cart total changed. Create a new Razorpay payment session before paying.')
    return { data }
  }
  async cancelPayment(input: CancelPaymentInput) {
    if (this.options.mode) return (await this.bound()).cancelPayment(input)

    const result = await this.verified(input.data)
    if (result.status === PaymentSessionStatus.CAPTURED) throw Error('Payment already captured. Refund it before cancelling.')
    return { data: result.data }
  }
  async deletePayment(input: DeletePaymentInput) { return this.cancelPayment(input) }
  async refundPayment(_input: RefundPaymentInput): Promise<{ data: Record<string, unknown> }> {
    // Never report a local refund as successful without a provider-confirmed refund.
    throw Error('Razorpay cart refunds require operator reconciliation; automatic refunds are not enabled yet.')
  }
  async getWebhookActionAndData(_payload: ProviderWebhookPayload['payload']): Promise<WebhookActionResult> {
    // Checkout completion always verifies against Razorpay directly; unverified webhooks cannot mark orders paid.
    return { action: 'not_supported' }
  }
}
