import { Modules } from '@medusajs/framework/utils'
import { updateRegionsWorkflow } from '@medusajs/medusa/core-flows'
// Explicit rollout step: do not silently change existing regional payment methods during normal startup.
export default async function ({ container }: any) {
  if (!process.env.RAZORPAY_CHECKOUT_MODE && (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)) throw Error('Configure server Razorpay credentials first')
  const provider = 'pp_razorpay_razorpay'
  const available = await container.resolve(Modules.PAYMENT).listPaymentProviders({ id: provider })
  if (!available.length) throw Error('Razorpay provider is not loaded; deploy configuration first')
  const regions = await container.resolve(Modules.REGION).listRegions({ currency_code: 'inr' }, { relations: ['countries'] })
  const india = regions.filter((r: any) => r.countries?.some((c: any) => c.iso_2 === 'in'))
  if (india.length !== 1) throw Error('Expected exactly one India INR region; select the region explicitly in Operations Settings')
  await updateRegionsWorkflow(container).run({ input: { selector: { id: india[0].id }, update: { payment_providers: [provider] } } })
  console.log('India checkout now uses Razorpay; demo/manual provider removed from this region')
}
