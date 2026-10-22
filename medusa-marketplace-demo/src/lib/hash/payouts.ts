import { fail } from "./access"
// Providers must use settlement.id as their idempotency key. Never retry an ambiguous transfer blindly.
export interface PayoutAdapter {
  id: string
  execute(input: { settlementId: string; amountPaise: number; currency: string; vendorId: string; reference?: string }): Promise<{ status: "paid" | "processing"; reference: string }>
}
export const manualPayout: PayoutAdapter = {
  id: "manual",
  async execute(input) {
    if (!input.reference?.trim()) fail("A bank transfer reference is required")
    return { status: "paid", reference: input.reference!.trim() }
  }
}

const adapters = new Map<string, PayoutAdapter>([[manualPayout.id, manualPayout]])
export function registerPayoutAdapter(adapter: PayoutAdapter) {
  if(adapters.has(adapter.id)) throw new Error(`Payout adapter ${adapter.id} is already registered`)
  adapters.set(adapter.id,adapter)
}
export function getPayoutAdapter(id: string): PayoutAdapter {
  const adapter=adapters.get(id)
  if(!adapter) throw new Error(`Payout adapter ${id} is not configured`)
  return adapter
}
